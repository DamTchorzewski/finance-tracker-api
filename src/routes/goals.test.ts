import { describe, expect, it } from "vitest";
import type { Account, Transaction } from "../schemas/ledger.ts";
import type { Contribution, Goal } from "../schemas/goals.ts";
import { memoryStore } from "../store/memory.ts";
import { testApp } from "../test/helpers.ts";

function setup() {
  const { request } = testApp({}, memoryStore());
  const call = async <T>(path: string, init: Parameters<typeof request>[1] = {}) => {
    const res = await request(`/api${path}`, init);
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  };
  const post = <T>(path: string, json: unknown) => call<T>(path, { method: "POST", json });
  return { call, post };
}

describe("goals", () => {
  it("adds a goal in the base currency and sums its contributions", async () => {
    const { call, post } = setup();
    const goal = await post<Goal>("/goals", {
      name: "Wakacje",
      targetMinor: 800_000,
      targetDate: "2027-06-30",
    });
    expect(goal.status).toBe(201);
    expect(goal.body).toMatchObject({
      currency: "PLN",
      savedMinor: 0,
      icon: "piggy-bank",
      archived: false,
    });

    await post(`/goals/${goal.body.id}/contributions`, { amountMinor: 50_000, date: "2026-11-10" });
    await post(`/goals/${goal.body.id}/contributions`, {
      amountMinor: 30_000,
      date: "2026-11-20",
      note: "Premia",
    });
    const out = await post<Contribution>(`/goals/${goal.body.id}/contributions`, {
      amountMinor: -10_000,
      date: "2026-11-21",
    });
    expect(out.status).toBe(201);

    const goals = await call<Goal[]>("/goals");
    expect(goals.body[0]?.savedMinor).toBe(70_000);

    const history = await call<Contribution[]>(`/goals/${goal.body.id}/contributions`);
    expect(history.body.map((c) => c.amountMinor)).toEqual([-10_000, 30_000, 50_000]);

    expect(
      (await call(`/goals/${goal.body.id}/contributions/${out.body.id}`, { method: "DELETE" }))
        .status,
    ).toBe(204);
    expect((await call<Goal[]>("/goals")).body[0]?.savedMinor).toBe(80_000);
  });

  it("follows the balance of a linked account and refuses contributions to it", async () => {
    const { call, post } = setup();
    const savings = await post<Account>("/accounts", {
      name: "Oszczędności",
      kind: "savings",
      currency: "PLN",
      openingBalanceMinor: 1_000_000,
    });
    const goal = await post<Goal>("/goals", {
      name: "Poduszka",
      targetMinor: 3_000_000,
      accountId: savings.body.id,
    });
    expect(goal.body.savedMinor).toBe(1_000_000);

    await post<Transaction>("/transactions", {
      accountId: savings.body.id,
      kind: "income",
      amountMinor: 200_000,
      date: "2026-11-20",
    });
    expect((await call<Goal[]>("/goals")).body[0]?.savedMinor).toBe(1_200_000);

    const refused = await post(`/goals/${goal.body.id}/contributions`, {
      amountMinor: 100,
      date: "2026-11-20",
    });
    expect(refused.status).toBe(409);
  });

  it("checks the linked account and the amounts", async () => {
    const { post } = setup();
    const euro = await post<Account>("/accounts", {
      name: "EUR",
      kind: "foreign",
      currency: "EUR",
    });
    expect(
      (await post("/goals", { name: "X", targetMinor: 100, accountId: euro.body.id })).status,
    ).toBe(400);
    expect(
      (await post("/goals", { name: "X", targetMinor: 100, accountId: "missing" })).status,
    ).toBe(404);
    expect((await post("/goals", { name: "X", targetMinor: 0 })).status).toBe(400);

    const goal = await post<Goal>("/goals", { name: "X", targetMinor: 100 });
    expect(
      (await post(`/goals/${goal.body.id}/contributions`, { amountMinor: 0, date: "2026-11-20" }))
        .status,
    ).toBe(400);
  });

  it("deletes a goal with its contributions and keeps them per user", async () => {
    const { call, post } = setup();
    const goal = await post<Goal>("/goals", { name: "Laptop", targetMinor: 650_000 });
    await post(`/goals/${goal.body.id}/contributions`, { amountMinor: 1000, date: "2026-11-20" });
    expect((await call("/goals", { token: "token-bob" })).body).toEqual([]);
    expect((await call(`/goals/${goal.body.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await call<Goal[]>("/goals")).body).toEqual([]);
    expect((await call(`/goals/${goal.body.id}/contributions`)).status).toBe(404);
  });

  it("accepts the goals widget on the dashboard", async () => {
    const { call } = setup();
    const res = await call("/me/profile", {
      method: "PATCH",
      json: { widgets: ["balance", "goals"] },
    });
    expect(res.status).toBe(200);
  });
});
