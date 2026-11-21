import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { AppEnv } from "../lib/auth.ts";
import { ApiError, errorResponses } from "../lib/errors.ts";
import type { Ledger } from "../ledger/service.ts";
import { Id, IdParam } from "../schemas/common.ts";
import {
  ContributionCreateSchema,
  ContributionSchema,
  GoalCreateSchema,
  GoalPatchSchema,
  GoalSchema,
  type Goal,
  type StoredGoal,
} from "../schemas/goals.ts";
import { DEFAULT_PROFILE } from "../schemas/profile.ts";
import type { Store } from "../store/types.ts";
import { validationHook } from "./hook.ts";

const security = [{ bearerAuth: [] }];
const tags = ["Goals"];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { required: true, content: { "application/json": { schema } } },
});
const errors = (...extra: Parameters<typeof errorResponses>) =>
  errorResponses("unauthorized", "forbidden", "rate_limited", ...extra);

const ContributionParams = z.object({
  id: Id.openapi({ param: { name: "id", in: "path" } }),
  contributionId: Id.openapi({ param: { name: "contributionId", in: "path" } }),
});

const list = createRoute({
  method: "get",
  path: "/goals",
  tags,
  security,
  summary: "The savings goals with what is saved in each",
  responses: { 200: json(z.array(GoalSchema), "The goals"), ...errors() },
});
const create = createRoute({
  method: "post",
  path: "/goals",
  tags,
  security,
  summary: "Add a goal; linked to an account, its balance is the progress",
  request: body(GoalCreateSchema),
  responses: { 201: json(GoalSchema, "Created"), ...errors("validation", "not_found") },
});
const patch = createRoute({
  method: "patch",
  path: "/goals/{id}",
  tags,
  security,
  summary: "Change some fields",
  request: { params: IdParam, ...body(GoalPatchSchema) },
  responses: { 200: json(GoalSchema, "Saved"), ...errors("validation", "not_found") },
});
const remove = createRoute({
  method: "delete",
  path: "/goals/{id}",
  tags,
  security,
  summary: "Delete a goal and its contributions",
  request: { params: IdParam },
  responses: { 204: { description: "Deleted" }, ...errors("not_found") },
});
const contributions = createRoute({
  method: "get",
  path: "/goals/{id}/contributions",
  tags,
  security,
  summary: "Money put in and taken out of a goal, newest first",
  request: { params: IdParam },
  responses: {
    200: json(z.array(ContributionSchema), "The contributions"),
    ...errors("not_found"),
  },
});
const contribute = createRoute({
  method: "post",
  path: "/goals/{id}/contributions",
  tags,
  security,
  summary: "Put money in (positive) or take it out (negative)",
  request: { params: IdParam, ...body(ContributionCreateSchema) },
  responses: {
    201: json(ContributionSchema, "Added"),
    ...errors("validation", "not_found", "conflict"),
  },
});
const uncontribute = createRoute({
  method: "delete",
  path: "/goals/{id}/contributions/{contributionId}",
  tags,
  security,
  summary: "Delete a contribution",
  request: { params: ContributionParams },
  responses: { 204: { description: "Deleted" }, ...errors("not_found") },
});

export const goalsRoutes = (store: Store, ledger: Ledger) => {
  /** What each goal has saved: its linked account's balance, or the sum of its contributions. */
  async function withSaved(uid: string, goals: StoredGoal[]): Promise<Goal[]> {
    const all = await store.contributions.list(uid);
    const sums = new Map<string, number>();
    for (const c of all) sums.set(c.goalId, (sums.get(c.goalId) ?? 0) + c.amountMinor);
    const accounts = new Map((await ledger.accounts(uid)).map((a) => [a.id, a]));
    return goals.map((goal) => ({
      ...goal,
      savedMinor: goal.accountId
        ? (accounts.get(goal.accountId)?.balanceMinor ?? 0)
        : (sums.get(goal.id) ?? 0),
    }));
  }

  async function goal(uid: string, id: string) {
    const found = await store.goals.get(uid, id);
    if (!found) throw new ApiError("not_found", `No goal ${id}`);
    return found;
  }

  /** A linked account must exist and hold the goal's currency, so its balance means the same money. */
  async function checkAccount(uid: string, accountId: string | null, currency: string) {
    if (!accountId) return;
    const account = await ledger.account(uid, accountId);
    if (account.currency !== currency) {
      throw new ApiError(
        "validation",
        `The account is in ${account.currency}, the goal in ${currency}`,
      );
    }
  }

  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });

  app
    .openapi(list, async (c) => {
      const { uid } = c.var.user;
      const goals = (await store.goals.list(uid)).sort(
        (a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt),
      );
      return c.json(await withSaved(uid, goals), 200);
    })
    .openapi(create, async (c) => {
      const { uid } = c.var.user;
      const input = c.req.valid("json");
      const currency =
        input.currency ??
        (await store.profiles.get(uid))?.baseCurrency ??
        DEFAULT_PROFILE.baseCurrency;
      await checkAccount(uid, input.accountId, currency);
      const at = ledger.stamp();
      const created = await store.goals.create(uid, {
        ...input,
        currency,
        archived: false,
        order: (await store.goals.list(uid)).length,
        createdAt: at,
        updatedAt: at,
      });
      const [result] = await withSaved(uid, [created]);
      return c.json(result!, 201);
    })
    .openapi(patch, async (c) => {
      const { uid } = c.var.user;
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const current = await goal(uid, id);
      if (input.accountId !== undefined) await checkAccount(uid, input.accountId, current.currency);
      const saved = await store.goals.update(uid, id, { ...input, updatedAt: ledger.stamp() });
      const [result] = await withSaved(uid, [saved ?? current]);
      return c.json(result!, 200);
    })
    .openapi(remove, async (c) => {
      const { uid } = c.var.user;
      const { id } = c.req.valid("param");
      await goal(uid, id);
      for (const contribution of await store.contributions.list(uid)) {
        if (contribution.goalId === id) await store.contributions.remove(uid, contribution.id);
      }
      await store.goals.remove(uid, id);
      return c.body(null, 204);
    })
    .openapi(contributions, async (c) => {
      const { uid } = c.var.user;
      const { id } = c.req.valid("param");
      await goal(uid, id);
      const items = (await store.contributions.list(uid))
        .filter((contribution) => contribution.goalId === id)
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
      return c.json(items, 200);
    })
    .openapi(contribute, async (c) => {
      const { uid } = c.var.user;
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const found = await goal(uid, id);
      if (found.accountId) {
        throw new ApiError(
          "conflict",
          "This goal follows an account: add a transfer to the account instead",
        );
      }
      const created = await store.contributions.create(uid, {
        ...input,
        goalId: id,
        createdAt: ledger.stamp(),
      });
      return c.json(created, 201);
    })
    .openapi(uncontribute, async (c) => {
      const { uid } = c.var.user;
      const { id, contributionId } = c.req.valid("param");
      const found = await store.contributions.get(uid, contributionId);
      if (!found || found.goalId !== id)
        throw new ApiError("not_found", `No contribution ${contributionId}`);
      await store.contributions.remove(uid, contributionId);
      return c.body(null, 204);
    });

  return app;
};
