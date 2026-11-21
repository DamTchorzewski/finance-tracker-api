import type { Firestore } from "firebase-admin/firestore";
import type { Profile } from "../schemas/profile.ts";
import type { ProfileStore, Store, UserCollection } from "./types.ts";

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

  private ref(uid: string) {
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

export const firestoreStore = (db: Firestore): Store => ({ profiles: new FirestoreProfiles(db) });
