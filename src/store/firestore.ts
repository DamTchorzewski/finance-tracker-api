import { FieldValue, type Firestore } from "firebase-admin/firestore";
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

/**
 * Version 2 keeps its data apart from version 1 (`users/{uid}/transactions` of personal-finance-manager):
 * apps/finance-tracker/users/{uid} holds the profile, its sub-collections the rest.
 */
export const USERS = "apps/finance-tracker/users";

class FirestoreProfiles implements ProfileStore {
  private readonly db: Firestore;

  constructor(db: Firestore) {
    this.db = db;
  }

  async get(uid: string) {
    const snap = await this.db.collection(USERS).doc(uid).get();
    return (snap.get("profile") as Profile | undefined) ?? null;
  }

  async set(uid: string, profile: Profile) {
    await this.db.collection(USERS).doc(uid).set({ profile }, { merge: true });
    return profile;
  }
}

export class FirestoreCollection<T extends { id: string }> implements UserCollection<T> {
  private readonly db: Firestore;
  private readonly name: string;

  constructor(db: Firestore, name: string) {
    this.db = db;
    this.name = name;
  }

  ref(uid: string) {
    return this.db.collection(USERS).doc(uid).collection(this.name);
  }

  async list(uid: string) {
    const snap = await this.ref(uid).get();
    return snap.docs.map((doc) => ({ ...doc.data(), id: doc.id }) as T);
  }

  async get(uid: string, id: string) {
    const doc = await this.ref(uid).doc(id).get();
    return doc.exists ? ({ ...doc.data(), id: doc.id } as T) : null;
  }

  async create(uid: string, data: Omit<T, "id">) {
    const ref = await this.ref(uid).add(data);
    return { ...data, id: ref.id } as T;
  }

  async update(uid: string, id: string, patch: Partial<Omit<T, "id">>) {
    const ref = this.ref(uid).doc(id);
    return this.db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return null;
      tx.update(ref, patch);
      return { ...doc.data(), ...patch, id } as T;
    });
  }

  async remove(uid: string, id: string) {
    const ref = this.ref(uid).doc(id);
    const doc = await ref.get();
    if (!doc.exists) return false;
    await ref.delete();
    return true;
  }
}

/** Firestore allows 500 writes per batch; the import keeps room for the account updates. */
const BATCH = 400;

class FirestoreTransactions implements TransactionStore {
  private readonly db: Firestore;
  private readonly items: FirestoreCollection<Transaction>;
  private readonly accounts: FirestoreCollection<StoredAccount>;

  constructor(db: Firestore, accounts: FirestoreCollection<StoredAccount>) {
    this.db = db;
    this.items = new FirestoreCollection<Transaction>(db, "transactions");
    this.accounts = accounts;
  }

  async listRange(uid: string, from: string, to: string) {
    const snap = await this.items
      .ref(uid)
      .where("date", ">=", from)
      .where("date", "<=", to)
      .orderBy("date", "desc")
      .get();
    return snap.docs
      .map((doc) => ({ ...doc.data(), id: doc.id }) as Transaction)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }

  get(uid: string, id: string) {
    return this.items.get(uid, id);
  }

  async uses(uid: string, field: "accountId" | "toAccountId" | "categoryId", id: string) {
    const snap = await this.items.ref(uid).where(field, "==", id).limit(1).get();
    return !snap.empty;
  }

  /** Adds the effects of `add` and takes away those of `undo` from the accounts, inside `tx`. */
  private moveFlows(
    tx: FirebaseFirestore.Transaction | FirebaseFirestore.WriteBatch,
    uid: string,
    effects: Map<string, number>,
  ) {
    for (const [accountId, minor] of effects) {
      if (minor === 0) continue;
      // both a transaction and a batch have update(ref, data); the union hides the shared overload
      (tx as FirebaseFirestore.WriteBatch).update(this.accounts.ref(uid).doc(accountId), {
        flowMinor: FieldValue.increment(minor),
      });
    }
  }

  async create(uid: string, data: NewTransaction) {
    const ref = this.items.ref(uid).doc();
    await this.db.runTransaction((tx) => {
      tx.set(ref, data);
      this.moveFlows(tx, uid, effectsOf(data));
      return Promise.resolve();
    });
    return { ...data, id: ref.id };
  }

  async createMany(uid: string, items: NewTransaction[]) {
    for (let start = 0; start < items.length; start += BATCH) {
      const batch = this.db.batch();
      const total = new Map<string, number>();
      for (const item of items.slice(start, start + BATCH)) {
        batch.set(this.items.ref(uid).doc(), item);
        for (const [account, minor] of effectsOf(item)) {
          total.set(account, (total.get(account) ?? 0) + minor);
        }
      }
      this.moveFlows(batch, uid, total);
      await batch.commit();
    }
    return items.length;
  }

  async replace(uid: string, id: string, data: NewTransaction) {
    const ref = this.items.ref(uid).doc(id);
    return this.db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return null;
      const effects = effectsOf(data);
      for (const [account, minor] of effectsOf(doc.data() as NewTransaction)) {
        effects.set(account, (effects.get(account) ?? 0) - minor);
      }
      tx.set(ref, data);
      this.moveFlows(tx, uid, effects);
      return { ...data, id };
    });
  }

  async remove(uid: string, id: string) {
    const ref = this.items.ref(uid).doc(id);
    return this.db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return null;
      const old = { ...(doc.data() as NewTransaction), id };
      const effects = new Map([...effectsOf(old)].map(([account, minor]) => [account, -minor]));
      tx.delete(ref);
      this.moveFlows(tx, uid, effects);
      return old;
    });
  }
}

class FirestoreMarks implements MarkStore {
  private readonly db: Firestore;

  constructor(db: Firestore) {
    this.db = db;
  }

  private ref(uid: string, key: string) {
    return this.db.collection(USERS).doc(uid).collection("marks").doc(key);
  }

  async get(uid: string, key: string) {
    const doc = await this.ref(uid, key).get();
    return doc.exists ? (doc.data() ?? null) : null;
  }

  async set(uid: string, key: string, value: Record<string, unknown>) {
    await this.ref(uid, key).set(value);
  }
}

/** Reads version 1 (personal-finance-manager-api): users/{uid}/transactions. Never writes there. */
class FirestoreLegacy implements LegacyReader {
  private readonly db: Firestore;

  constructor(db: Firestore) {
    this.db = db;
  }

  async transactions(uid: string) {
    const snap = await this.db.collection("users").doc(uid).collection("transactions").get();
    return snap.docs.map((doc) => ({ ...doc.data(), id: doc.id }) as LegacyTransaction);
  }
}

export const firestoreStore = (db: Firestore): Store => {
  const accounts = new FirestoreCollection<StoredAccount>(db, "accounts");
  return {
    profiles: new FirestoreProfiles(db),
    accounts,
    categories: new FirestoreCollection<Category>(db, "categories"),
    budgets: new FirestoreCollection<Budget>(db, "budgets"),
    goals: new FirestoreCollection<StoredGoal>(db, "goals"),
    contributions: new FirestoreCollection<Contribution>(db, "goal-contributions"),
    transactions: new FirestoreTransactions(db, accounts),
    marks: new FirestoreMarks(db),
    legacy: new FirestoreLegacy(db),
  };
};
