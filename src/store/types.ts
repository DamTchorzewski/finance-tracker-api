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

/** Everything the routes read and write. Firestore in production, memory in tests. */
export interface Store {
  profiles: ProfileStore;
}
