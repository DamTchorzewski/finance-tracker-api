import { createMiddleware } from "hono/factory";
import { ApiError } from "./errors.ts";

export interface AuthUser {
  uid: string;
  email: string | null;
  name: string | null;
  emailVerified: boolean;
}

/** Checks a Firebase ID token; throws when it is not valid. Firebase Admin in production, a fake in tests. */
export interface TokenVerifier {
  verify(token: string): Promise<AuthUser>;
}

export interface AppEnv {
  Variables: { user: AuthUser };
}

/** Requires "Authorization: Bearer <Firebase ID token>" on every request and sets c.var.user. */
export const requireUser = (verifier: TokenVerifier, options: { requireVerifiedEmail: boolean }) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const [scheme, token] = (c.req.header("authorization") ?? "").split(" ");
    if (scheme !== "Bearer" || !token) throw new ApiError("unauthorized", "Not signed in");

    let user: AuthUser;
    try {
      user = await verifier.verify(token);
    } catch {
      throw new ApiError("unauthorized", "The sign-in has expired or is not valid");
    }
    if (options.requireVerifiedEmail && !user.emailVerified) {
      throw new ApiError("forbidden", "The e-mail address is not confirmed yet");
    }

    c.set("user", user);
    await next();
  });
