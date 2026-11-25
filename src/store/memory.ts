import { randomUUID } from "node:crypto";
import type { Contribution, StoredGoal } from "../schemas/goals.ts";
import type { Budget, Category, StoredAccount, Transaction } from "../schemas/ledger.ts";
import type { Profile } from "../schemas/profile.ts";
import {
  effectsOf,
  type LegacyReader,
  type LegacyTransaction,
  type MarkStore,
  type NewTransaction,
  type ProfileStore,
  type Store,
  type TransactionStore,
  type UserCollection,
} from "./types.ts";

const clone = <T>(value: T): T => structuredClone(value);
const newId = () => randomUUID().replaceAll("-", "").slice(0, 20);

class MemoryProfiles implements ProfileStore {
  private readonly items = new Map<string, Profile>();

  get(uid: string) {
    const item = this.items.get(uid);
    return Promise.resolve(item ? clone(item) : null);
  }

  set(uid: string, profile: Profile) {
    this.items.set(uid, clone(profile));
    return Promise.resolve(clone(profile));
  }
}

class MemoryCollection<T extends { id: string }> implements UserCollection<T> {
  private readonly items = new Map<string, Map<string, T>>();

  of(uid: string) {
    let docs = this.items.get(uid);
    if (!docs) {
      docs = new Map<string, T>();
      this.items.set(uid, docs);
    }
    return docs;
  }

  list(uid: string) {
    return Promise.resolve([...this.of(uid).values()].map(clone));
  }

  get(uid: string, id: string) {
    const item = this.of(uid).get(id);
    return Promise.resolve(item ? clone(item) : null);
  }

  create(uid: string, data: Omit<T, "id">) {
    const item = { ...clone(data), id: newId() } as T;
    this.of(uid).set(item.id, item);
    return Promise.resolve(clone(item));
  }

  update(uid: string, id: string, patch: Partial<Omit<T, "id">>) {
    const docs = this.of(uid);
    const item = docs.get(id);
    if (!item) return Promise.resolve(null);
    const next: T = { ...item, ...clone(patch), id };
    docs.set(id, next);
    return Promise.resolve(clone(next));
  }

  remove(uid: string, id: string) {
    return Promise.resolve(this.of(uid).delete(id));
  }
}

class MemoryTransactions implements TransactionStore {
  private readonly items = new MemoryCollection<Transaction>();
  private readonly accounts: MemoryCollection<StoredAccount>;

  constructor(accounts: MemoryCollection<StoredAccount>) {
    this.accounts = accounts;
  }

  private apply(uid: string, tx: NewTransaction, sign: 1 | -1) {
    for (const [accountId, minor] of effectsOf(tx)) {
      const account = this.accounts.of(uid).get(accountId);
      if (account) account.flowMinor += sign * minor;
    }
  }

  async listRange(uid: string, from: string, to: string) {
    const all = await this.items.list(uid);
    return all
      .filter((tx) => tx.date >= from && tx.date <= to)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }

  get(uid: string, id: string) {
    return this.items.get(uid, id);
  }

  async uses(uid: string, field: "accountId" | "toAccountId" | "categoryId", id: string) {
    return (await this.items.list(uid)).some((tx) => tx[field] === id);
  }

  async create(uid: string, data: NewTransaction) {
    const tx = await this.items.create(uid, data);
    this.apply(uid, data, 1);
    return tx;
  }

  async createMany(uid: string, items: NewTransaction[]) {
    for (const item of items) await this.create(uid, item);
    return items.length;
  }

  async replace(uid: string, id: string, data: NewTransaction) {
    const old = await this.items.get(uid, id);
    if (!old) return null;
    this.apply(uid, old, -1);
    this.apply(uid, data, 1);
    return this.items.update(uid, id, data);
  }

  async remove(uid: string, id: string) {
    const old = await this.items.get(uid, id);
    if (!old) return null;
    this.apply(uid, old, -1);
    await this.items.remove(uid, id);
    return old;
  }
}

class MemoryMarks implements MarkStore {
  private readonly items = new Map<string, Record<string, unknown>>();

  get(uid: string, key: string) {
    return Promise.resolve(this.items.get(`${uid}/${key}`) ?? null);
  }

  set(uid: string, key: string, value: Record<string, unknown>) {
    this.items.set(`${uid}/${key}`, clone(value));
    return Promise.resolve();
  }
}

/** Version 1 data for tests: put documents in `items` keyed by uid. */
export class MemoryLegacy implements LegacyReader {
  readonly items = new Map<string, LegacyTransaction[]>();

  transactions(uid: string) {
    return Promise.resolve(clone(this.items.get(uid) ?? []));
  }
}

export const memoryStore = (): Store & { legacy: MemoryLegacy } => {
  const accounts = new MemoryCollection<StoredAccount>();
  return {
    profiles: new MemoryProfiles(),
    accounts,
    categories: new MemoryCollection<Category>(),
    budgets: new MemoryCollection<Budget>(),
    goals: new MemoryCollection<StoredGoal>(),
    contributions: new MemoryCollection<Contribution>(),
    transactions: new MemoryTransactions(accounts),
    marks: new MemoryMarks(),
    legacy: new MemoryLegacy(),
  };
};
