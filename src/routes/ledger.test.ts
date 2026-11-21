import { describe, expect, it } from "vitest";
import { MemoryRateCache } from "../rates/cache.ts";
import { RatesService } from "../rates/service.ts";
import type { Account, Budget, Category, Transaction } from "../schemas/ledger.ts";
import { memoryStore } from "../store/memory.ts";
import { testApp } from "../test/helpers.ts";

/** NBP answers every table request with EUR 4.25 and USD 4.00 on 2026-11-20. */
const rates = () =>
  new RatesService({
    cache: new MemoryRateCache(),
    now: () => new Date("2026-11-21T09:00:00Z"),
    fetcher: () =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            {
              effectiveDate: "2026-11-20",
              rates: [
                { code: "EUR", mid: 4.25 },
                { code: "USD", mid: 4.0 },
              ],
            },
          ]),
        ),
      ),
  });

function setup() {
  const store = memoryStore();
  const { request } = testApp({}, store, rates());
  const call = async <T>(path: string, init: Parameters<typeof request>[1] = {}) => {
    const res = await request(`/api${path}`, init);
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  };
  const post = <T>(path: string, json: unknown) => call<T>(path, { method: "POST", json });
  const patch = <T>(path: string, json: unknown) => call<T>(path, { method: "PATCH", json });

  const account = async (name: string, currency = "PLN", openingBalanceMinor = 0) =>
    (await post<Account>("/accounts", { name, kind: "bank", currency, openingBalanceMinor })).body;
  const category = async (key: string) =>
    (await call<Category[]>("/categories")).body.find((item) => item.key === key) as Category;
  const balance = async (id: string) => (await call<Account>(`/accounts/${id}`)).body.balanceMinor;

  return { store, call, post, patch, account, category, balance };
}

describe("categories", () => {
  it("seeds the default set in the user's language on the first list", async () => {
    const { call, patch } = setup();
    const pl = (await call<Category[]>("/categories")).body;
    expect(pl.find((item) => item.key === "groceries")?.name).toBe("Zakupy spożywcze");
    expect(pl.filter((item) => item.kind === "income").map((item) => item.key)).toEqual([
      "salary",
      "freelance",
      "other-income",
    ]);
    expect((await call<Category[]>("/categories")).body).toHaveLength(pl.length);

    const other = setup();
    await other.patch("/me/profile", { locale: "en" });
    expect((await other.category("groceries")).name).toBe("Groceries");
    await patch(`/categories/${pl[0]?.id}`, { name: "Jedzenie" });
    expect((await call<Category>(`/categories/${pl[0]?.id}`)).body.name).toBe("Jedzenie");
  });

  it("adds own categories and refuses to delete one in use", async () => {
    const { post, call, account, category } = setup();
    const own = await post<Category>("/categories", {
      name: "Rower",
      kind: "expense",
      icon: "bike",
      colour: "lime",
    });
    expect(own.status).toBe(201);
    expect(own.body.key).toBeNull();

    const wallet = await account("Konto");
    const groceries = await category("groceries");
    await post("/transactions", {
      accountId: wallet.id,
      kind: "expense",
      amountMinor: 1000,
      date: "2026-11-20",
      categoryId: groceries.id,
    });
    expect((await call(`/categories/${groceries.id}`, { method: "DELETE" })).status).toBe(409);
    expect((await call(`/categories/${own.body.id}`, { method: "DELETE" })).status).toBe(204);
  });
});

describe("transactions and balances", () => {
  it("keeps every account's balance equal to its opening balance plus its transactions", async () => {
    const { post, patch, call, account, category, balance } = setup();
    const bank = await account("Bank", "PLN", 100_000);
    const cash = await account("Gotówka");
    const groceries = await category("groceries");
    const salary = await category("salary");

    const spent = await post<Transaction>("/transactions", {
      accountId: bank.id,
      kind: "expense",
      amountMinor: 8640,
      date: "2026-11-19",
      categoryId: groceries.id,
      note: "Biedronka",
      tags: ["dom"],
    });
    expect(spent.status).toBe(201);
    expect(spent.body).toMatchObject({ currency: "PLN", plnMinor: 8640, origin: "app" });
    expect(spent.body.rate).toEqual({ source: "pln", date: "2026-11-19", mid: 1 });

    await post("/transactions", {
      accountId: bank.id,
      kind: "income",
      amountMinor: 520_000,
      date: "2026-11-10",
      categoryId: salary.id,
    });
    await post("/transactions", {
      accountId: bank.id,
      kind: "transfer",
      amountMinor: 20_000,
      date: "2026-11-15",
      toAccountId: cash.id,
    });
    expect(await balance(bank.id)).toBe(100_000 - 8640 + 520_000 - 20_000);
    expect(await balance(cash.id)).toBe(20_000);

    // a change moves the balance by the difference, a delete gives the money back
    await patch(`/transactions/${spent.body.id}`, { amountMinor: 10_000 });
    expect(await balance(bank.id)).toBe(100_000 - 10_000 + 520_000 - 20_000);
    expect((await call(`/transactions/${spent.body.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await balance(bank.id)).toBe(100_000 + 520_000 - 20_000);

    // an opening balance change does not need the transactions again
    await patch(`/accounts/${cash.id}`, { openingBalanceMinor: 5000 });
    expect(await balance(cash.id)).toBe(25_000);
  });

  it("freezes the PLN value of a foreign transaction at the rate of its day", async () => {
    const { post, account, category } = setup();
    const euro = await account("Konto EUR", "EUR");
    const eatingOut = await category("eating-out");
    const tx = await post<Transaction>("/transactions", {
      accountId: euro.id,
      kind: "expense",
      amountMinor: 2000,
      date: "2026-11-21",
      categoryId: eatingOut.id,
    });
    expect(tx.body).toMatchObject({ currency: "EUR", plnMinor: 8500 });
    expect(tx.body.rate).toEqual({ source: "nbp-a", date: "2026-11-20", mid: 4.25 });
  });

  it("converts a transfer between currencies unless the received amount is given", async () => {
    const { post, account, balance } = setup();
    const pln = await account("PLN");
    const usd = await account("USD", "USD");
    await post("/transactions", {
      accountId: pln.id,
      kind: "transfer",
      amountMinor: 40_000,
      date: "2026-11-20",
      toAccountId: usd.id,
    });
    expect(await balance(usd.id)).toBe(10_000);
    await post("/transactions", {
      accountId: pln.id,
      kind: "transfer",
      amountMinor: 4000,
      date: "2026-11-20",
      toAccountId: usd.id,
      toAmountMinor: 990,
    });
    expect(await balance(usd.id)).toBe(10_990);
  });

  it("checks the transaction against the accounts and categories", async () => {
    const { post, account, category } = setup();
    const bank = await account("Bank");
    const salary = await category("salary");
    const base = { accountId: bank.id, amountMinor: 100, date: "2026-11-20" };

    const wrongKind = await post("/transactions", {
      ...base,
      kind: "expense",
      categoryId: salary.id,
    });
    expect(wrongKind.status).toBe(400);
    expect(
      (await post("/transactions", { ...base, accountId: "nope", kind: "expense" })).status,
    ).toBe(404);
    expect(
      (await post("/transactions", { ...base, kind: "transfer", toAccountId: bank.id })).status,
    ).toBe(400);
    expect((await post("/transactions", { ...base, kind: "transfer" })).status).toBe(400);
    expect(
      (await post("/transactions", { ...base, kind: "expense", amountMinor: -5 })).status,
    ).toBe(400);
    expect(
      (await post("/transactions", { ...base, kind: "expense", amountMinor: 1.5 })).status,
    ).toBe(400);
    expect(
      (await post("/transactions", { ...base, kind: "expense", date: "2026-13-01" })).status,
    ).toBe(400);
  });

  it("lists a date range newest first, filtered and searched", async () => {
    const { post, call, account, category } = setup();
    const bank = await account("Bank");
    const groceries = await category("groceries");
    for (const [date, note] of [
      ["2026-09-01", "Stary"],
      ["2026-11-01", "Lidl"],
      ["2026-11-18", "Biedronka"],
    ] as const) {
      await post("/transactions", {
        accountId: bank.id,
        kind: "expense",
        amountMinor: 500,
        date,
        note,
        categoryId: groceries.id,
      });
    }
    const november = await call<Transaction[]>("/transactions?from=2026-11-01&to=2026-11-30");
    expect(november.body.map((tx) => tx.note)).toEqual(["Biedronka", "Lidl"]);
    const search = await call<Transaction[]>("/transactions?from=2026-01-01&to=2026-12-31&q=biedr");
    expect(search.body.map((tx) => tx.note)).toEqual(["Biedronka"]);
    expect((await call("/transactions?from=2024-01-01&to=2026-12-31")).status).toBe(400);
  });

  it("refuses to delete an account with transactions, but archives it", async () => {
    const { post, patch, call, account } = setup();
    const bank = await account("Bank");
    await post("/transactions", {
      accountId: bank.id,
      kind: "expense",
      amountMinor: 1,
      date: "2026-11-20",
    });
    expect((await call(`/accounts/${bank.id}`, { method: "DELETE" })).status).toBe(409);
    expect((await patch<Account>(`/accounts/${bank.id}`, { archived: true })).body.archived).toBe(
      true,
    );
    const empty = await account("Pusty");
    expect((await call(`/accounts/${empty.id}`, { method: "DELETE" })).status).toBe(204);
  });
});

describe("budgets", () => {
  it("allows one budget per expense category in the base currency", async () => {
    const { post, patch, category } = setup();
    await patch("/me/profile", { baseCurrency: "EUR" });
    const groceries = await category("groceries");
    const salary = await category("salary");

    const budget = await post<Budget>("/budgets", { categoryId: groceries.id, limitMinor: 50_000 });
    expect(budget.status).toBe(201);
    expect(budget.body).toMatchObject({ currency: "EUR", alertAt: [0.8, 1], rollover: false });
    expect((await post("/budgets", { categoryId: groceries.id, limitMinor: 1 })).status).toBe(409);
    expect((await post("/budgets", { categoryId: salary.id, limitMinor: 1 })).status).toBe(400);
    expect(
      (await patch<Budget>(`/budgets/${budget.body.id}`, { limitMinor: 60_000 })).body.limitMinor,
    ).toBe(60_000);
  });
});

describe("import from version 1", () => {
  it("copies the old transactions once into a PLN account with mapped categories", async () => {
    const { store, post, call, category } = setup();
    store.legacy.items.set("alice", [
      {
        id: "a",
        type: "-",
        category: "Products",
        date: { day: "02", month: "11", year: "2026" },
        comment: "Zakupy",
        sum: "86.40",
      },
      {
        id: "b",
        type: "+",
        category: "Income",
        date: { day: "1", month: "11", year: "2026" },
        comment: "Pensja",
        sum: 5200,
      },
      { id: "c", type: "-", date: { day: "x", month: "11", year: "2026" }, sum: "1" },
    ]);

    const first = await post<{ imported: number; skipped: number; account: Account }>(
      "/import/v1",
      {},
    );
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ imported: 2, skipped: 1 });
    expect(first.body.account).toMatchObject({ currency: "PLN", balanceMinor: 520_000 - 8640 });

    const list = await call<Transaction[]>("/transactions?from=2026-11-01&to=2026-11-30");
    const groceries = await category("groceries");
    expect(list.body.find((tx) => tx.note === "Zakupy")).toMatchObject({
      categoryId: groceries.id,
      origin: "import-v1",
      date: "2026-11-02",
    });
    expect((await post("/import/v1", {})).status).toBe(409);
  });
});

describe("sign-in", () => {
  it("is required on every private route", async () => {
    const { call } = setup();
    for (const path of ["/accounts", "/categories", "/budgets", "/transactions"]) {
      expect((await call(path, { token: null })).status).toBe(401);
    }
    expect((await call("/import/v1", { method: "POST", token: null })).status).toBe(401);
  });
});
