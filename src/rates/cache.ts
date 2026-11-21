import type { Firestore } from "firebase-admin/firestore";
import type { MidTable, RateCache } from "./types.ts";

const ROOT = "apps/finance-tracker";

/** Tables in apps/finance-tracker/rates/{source}-{date}; resolutions in apps/finance-tracker/rate-days/{source}-{day}. */
export class FirestoreRateCache implements RateCache {
  private readonly db: Firestore;

  constructor(db: Firestore) {
    this.db = db;
  }

  async getTable(source: MidTable["source"], date: string) {
    const doc = await this.db.collection(`${ROOT}/rates`).doc(`${source}-${date}`).get();
    return doc.exists ? (doc.data() as MidTable) : null;
  }

  async putTables(tables: MidTable[]) {
    if (!tables.length) return;
    const batch = this.db.batch();
    for (const table of tables) {
      batch.set(this.db.collection(`${ROOT}/rates`).doc(`${table.source}-${table.date}`), table);
    }
    await batch.commit();
  }

  async getResolved(source: MidTable["source"], day: string) {
    const doc = await this.db.collection(`${ROOT}/rate-days`).doc(`${source}-${day}`).get();
    return (doc.get("date") as string | undefined) ?? null;
  }

  async putResolved(source: MidTable["source"], day: string, date: string) {
    await this.db.collection(`${ROOT}/rate-days`).doc(`${source}-${day}`).set({ date });
  }
}

export class MemoryRateCache implements RateCache {
  readonly tables = new Map<string, MidTable>();
  readonly resolved = new Map<string, string>();

  getTable(source: MidTable["source"], date: string) {
    return Promise.resolve(this.tables.get(`${source}-${date}`) ?? null);
  }

  putTables(tables: MidTable[]) {
    for (const table of tables) this.tables.set(`${table.source}-${table.date}`, table);
    return Promise.resolve();
  }

  getResolved(source: MidTable["source"], day: string) {
    return Promise.resolve(this.resolved.get(`${source}-${day}`) ?? null);
  }

  putResolved(source: MidTable["source"], day: string, date: string) {
    this.resolved.set(`${source}-${day}`, date);
    return Promise.resolve();
  }
}
