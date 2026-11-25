import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import type { AppEnv } from "../lib/auth.ts";
import {
  DEFAULT_PROFILE,
  MeSchema,
  ProfilePatchSchema,
  ProfileSchema,
} from "../schemas/profile.ts";
import type { Store } from "../store/types.ts";
import { validationHook } from "./hook.ts";
import { body, errors, json, security } from "./openapi.ts";

const getMe = createRoute({
  method: "get",
  path: "/me",
  tags: ["Profile"],
  summary: "The signed-in user and their settings (defaults until they change one)",
  security,
  responses: {
    200: json(MeSchema, "User and profile"),
    ...errors(),
  },
});

const patchProfile = createRoute({
  method: "patch",
  path: "/me/profile",
  tags: ["Profile"],
  summary: "Change some settings; the fields that are not sent keep their value",
  security,
  request: body(ProfilePatchSchema),
  responses: {
    200: json(ProfileSchema, "The saved profile"),
    ...errors("validation"),
  },
});

export const meRoutes = (store: Store) =>
  new OpenAPIHono<AppEnv>({ defaultHook: validationHook })
    .openapi(getMe, async (c) => {
      const { user } = c.var;
      const profile = (await store.profiles.get(user.uid)) ?? DEFAULT_PROFILE;
      return c.json({ user, profile: { ...DEFAULT_PROFILE, ...profile } }, 200);
    })
    .openapi(patchProfile, async (c) => {
      const { uid } = c.var.user;
      const current = (await store.profiles.get(uid)) ?? DEFAULT_PROFILE;
      const saved = await store.profiles.set(uid, {
        ...DEFAULT_PROFILE,
        ...current,
        ...c.req.valid("json"),
      });
      return c.json(saved, 200);
    });
