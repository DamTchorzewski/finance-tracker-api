// Runs against the Firestore emulator: `pnpm test:emulator` (needs Java 21+; CI runs it). The same routes as the
// unit tests, but with the real Firestore store, to prove the transactions, batches and queries Firestore accepts.
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { FirestoreRateCache, MemoryRateCache } from "../rates/cache.ts";
import { RatesService } from "../rates/service.ts";
import type { Account, Category, Transaction } from "../schemas/ledger.ts";
import { testApp } from "../test/helpers.ts";
import { firestoreStore } from "./firestore.ts";

const projectId = "demo-finance-tracker";
const db = getFirestore(initializeApp({ projectId }, "emulator"));
db.settings({ ignoreUndefinedProperties: true });

const offlineRates = new RatesService({
  fetcher: () => Promise.reject(new Error("offline")),
  cache: new MemoryRateCache(),
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST is not set: run `pnpm test:emulator`");
  await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, {
    method: "DELETE",
  });
});

function setup() {
  const { request } = testApp({}, firestoreStore(db), offlineRates);
  return async <T>(path: string, init: Parameters<typeof request>[1] = {}) => {
    const res = await request(`/api${path}`, init);
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  };
}

describe("Firestore store", () => {
  it("keeps balances through create, replace, delete and a transfer", async () => {
    const call = setup();
    const post = <T>(path: string, json: unknown) => call<T>(path, { method: "POST", json });
    const bank = (
      await post<Account>("/accounts", {
        name: "Bank",
        kind: "bank",
        currency: "PLN",
        openingBalanceMinor: 1000,
      })
    ).body;
    const cash = (await post<Account>("/accounts", { name: "Cash", kind: "cash", currency: "PLN" }))
      .body;
    const categories = (await call<Category[]>("/categories")).body;
    expect(categories).toHaveLength(17);
    const groceries = categories.find((item) => item.key === "groceries") as Category;

    const tx = await post<Transaction>("/transactions", {
      accountId: bank.id,
      kind: "expense",
      amountMinor: 300,
      date: "2026-11-20",
      categoryId: groceries.id,
    });
    expect(tx.status).toBe(201);
    await post("/transactions", {
      accountId: bank.id,
      kind: "transfer",
      amountMinor: 200,
      date: "2026-11-19",
      toAccountId: cash.id,
    });
    await call(`/transactions/${tx.body.id}`, { method: "PATCH", json: { amountMinor: 400 } });

    const balanceOf = async (id: string) =>
      (await call<Account>(`/accounts/${id}`)).body.balanceMinor;
    expect(await balanceOf(bank.id)).toBe(1000 - 400 - 200);
    expect(await balanceOf(cash.id)).toBe(200);

    expect((await call(`/transactions/${tx.body.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await balanceOf(bank.id)).toBe(800);
    expect((await call(`/accounts/${cash.id}`, { method: "DELETE" })).status).toBe(409);

    const list = await call<Transaction[]>("/transactions?from=2026-11-01&to=2026-11-30");
    expect(list.body).toHaveLength(1);
  });

  it("imports version 1 from users/{uid}/transactions in a batch, once", async () => {
    await db
      .collection("users")
      .doc("alice")
      .collection("transactions")
      .add({
        type: "-",
        category: "Car",
        date: { day: "05", month: "10", year: "2026" },
        comment: "Paliwo",
        sum: "210.00",
      });
    const call = setup();
    const first = await call<{ imported: number; account: Account }>("/import/v1", {
      method: "POST",
    });
    expect(first.body.imported).toBe(1);
    expect(first.body.account.balanceMinor).toBe(-21_000);
    expect((await call("/import/v1", { method: "POST" })).status).toBe(409);
  });

  it("saves the profile and the rate cache", async () => {
    const call = setup();
    await call("/me/profile", { method: "PATCH", json: { baseCurrency: "EUR" } });
    expect(
      (await call<{ profile: { baseCurrency: string } }>("/me")).body.profile.baseCurrency,
    ).toBe("EUR");

    const cache = new FirestoreRateCache(db);
    await cache.putTables([{ source: "nbp-a", date: "2026-11-20", rates: { EUR: 4.25 } }]);
    await cache.putResolved("nbp-a", "2026-11-22", "2026-11-20");
    expect(await cache.getResolved("nbp-a", "2026-11-22")).toBe("2026-11-20");
    expect((await cache.getTable("nbp-a", "2026-11-20"))?.rates.EUR).toBe(4.25);
  });
});
