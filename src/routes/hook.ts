import type { Hook } from "@hono/zod-openapi";
import { errorBody, issuesOf } from "../lib/errors.ts";

/** A request that does not match its schema gets 400 with one issue per wrong field. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const validationHook: Hook<any, any, any, any> = (result, c) => {
  if (!result.success) {
    return c.json(errorBody("validation", "The request is not valid", issuesOf(result.error)), 400);
  }
};
