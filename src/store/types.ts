import type { Contribution, StoredGoal } from "../schemas/goals.ts";
import type { Budget, Category, StoredAccount, Transaction } from "../schemas/ledger.ts";
import type { Profile } from "../schemas/profile.ts";

/** One user's profile document. */
export interface ProfileStore {
  get(uid: string): Promise<Profile | null>;
  set(uid: string, profile: Profile): Promise<Profile>;
}

/** A collection of documents that belong to one user. */
export interface UserCollection<T extends { id: string }> {
  list(uid: string): Promise<T[]>;
  get(uid: string, id: string): Promise<T | null>;
  create(uid: string, data: Omit<T, "id">): Promise<T>;
  update(uid: string, id: string, patch: Partial<Omit<T, "id">>): Promise<T | null>;
  remove(uid: string, id: string): Promise<boolean>;
}

export type NewTransaction = Omit<Transaction, "id">;

/** How much a transaction moves each account it touches (minor units of that account). */
export function effectsOf(tx: NewTransaction): Map<string, number> {
  const effects = new Map<string, number>();
  const add = (account: string, minor: number) =>
    effects.set(account, (effects.get(account) ?? 0) + minor);
  if (tx.kind === "income") add(tx.accountId, tx.amountMinor);
  else add(tx.accountId, -tx.amountMinor);
  if (tx.kind === "transfer" && tx.toAccountId) {
    add(tx.toAccountId, tx.toAmountMinor ?? tx.amountMinor);
  }
  return effects;
}

/**
 * Transactions, written together with the `flowMinor` of the accounts they touch, in one atomic step, so an
 * account's balance always equals its opening balance plus its transactions.
 */
export interface TransactionStore {
  /** Every transaction with `date` between two days (both included), newest first. */
  listRange(uid: string, from: string, to: string): Promise<Transaction[]>;
  get(uid: string, id: string): Promise<Transaction | null>;
  /** True when a transaction uses the account (as either side) or the category. */
  uses(
    uid: string,
    field: "accountId" | "toAccountId" | "categoryId",
    id: string,
  ): Promise<boolean>;
  create(uid: string, data: NewTransaction): Promise<Transaction>;
  /** Many at once (the import), in batches; the accounts get the sum of the effects. */
  createMany(uid: string, items: NewTransaction[]): Promise<number>;
  replace(uid: string, id: string, data: NewTransaction): Promise<Transaction | null>;
  remove(uid: string, id: string): Promise<Transaction | null>;
}

/** Version 1 documents (personal-finance-manager): users/{uid}/transactions, read only, for the import. */
export interface LegacyTransaction {
  id: string;
  type: "+" | "-";
  category?: string;
  date: { day: string; month: string; year: string };
  comment?: string;
  sum: string | number;
}

export interface LegacyReader {
  transactions(uid: string): Promise<LegacyTransaction[]>;
}

/** Marks of one-time actions (the import), so they cannot run twice. */
export interface MarkStore {
  get(uid: string, key: string): Promise<Record<string, unknown> | null>;
  set(uid: string, key: string, value: Record<string, unknown>): Promise<void>;
}

/** Everything the routes read and write. Firestore in production, memory in tests. */
export interface Store {
  profiles: ProfileStore;
  accounts: UserCollection<StoredAccount>;
  categories: UserCollection<Category>;
  budgets: UserCollection<Budget>;
  goals: UserCollection<StoredGoal>;
  contributions: UserCollection<Contribution>;
  transactions: TransactionStore;
  marks: MarkStore;
  legacy: LegacyReader;
}
