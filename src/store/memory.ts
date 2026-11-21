import { randomUUID } from "node:crypto";
import type { Profile } from "../schemas/profile.ts";
import type { ProfileStore, Store, UserCollection } from "./types.ts";

const clone = <T>(value: T): T => structuredClone(value);

export class MemoryProfiles implements ProfileStore {
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

export class MemoryCollection<T extends { id: string }> implements UserCollection<T> {
  private readonly items = new Map<string, Map<string, T>>();

  private of(uid: string) {
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
    const item = { ...clone(data), id: randomUUID().slice(0, 20) } as T;
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

export const memoryStore = (): Store => ({ profiles: new MemoryProfiles() });
