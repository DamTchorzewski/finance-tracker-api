import { createRoute, z } from "@hono/zod-openapi";
import { errorResponses } from "../lib/errors.ts";
import { IdParam } from "../schemas/common.ts";

// The parts every signed-in route shares in the OpenAPI contract.
export const security = [{ bearerAuth: [] }];

export const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
export const body = <T extends z.ZodType>(schema: T) => ({
  body: { required: true, content: { "application/json": { schema } } },
});
export const errors = (...extra: Parameters<typeof errorResponses>) =>
  errorResponses("unauthorized", "forbidden", "rate_limited", ...extra);

/** Five routes per resource: list, create, read, change, delete. */
export function crudRoutes(
  tag: string,
  path: string,
  schemas: { item: z.ZodType; create: z.ZodType; patch: z.ZodType },
) {
  const tags = [tag];
  return {
    list: createRoute({
      method: "get",
      path,
      tags,
      security,
      summary: `List the ${tag.toLowerCase()}`,
      responses: { 200: json(z.array(schemas.item), "The list"), ...errors() },
    }),
    create: createRoute({
      method: "post",
      path,
      tags,
      security,
      summary: "Add one",
      request: body(schemas.create),
      responses: {
        201: json(schemas.item, "Created"),
        ...errors("validation", "not_found", "conflict"),
      },
    }),
    read: createRoute({
      method: "get",
      path: `${path}/{id}`,
      tags,
      security,
      summary: "Read one",
      request: { params: IdParam },
      responses: { 200: json(schemas.item, "The item"), ...errors("not_found") },
    }),
    patch: createRoute({
      method: "patch",
      path: `${path}/{id}`,
      tags,
      security,
      summary: "Change some fields",
      request: { params: IdParam, ...body(schemas.patch) },
      responses: { 200: json(schemas.item, "Saved"), ...errors("validation", "not_found") },
    }),
    remove: createRoute({
      method: "delete",
      path: `${path}/{id}`,
      tags,
      security,
      summary: "Delete one",
      request: { params: IdParam },
      responses: { 204: { description: "Deleted" }, ...errors("not_found", "conflict") },
    }),
  };
}
