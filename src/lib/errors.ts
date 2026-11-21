import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ZodError } from "zod";

export const ERROR_CODES = [
  "bad_request",
  "validation",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "payload_too_large",
  "rate_limited",
  "upstream_unavailable",
  "internal",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  bad_request: 400,
  validation: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  rate_limited: 429,
  upstream_unavailable: 503,
  internal: 500,
};

export interface Issue {
  path: string;
  message: string;
}

/** Every error answer has this shape. */
export const ErrorSchema = z
  .object({
    error: z.object({
      code: z.enum(ERROR_CODES),
      message: z.string(),
      issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    }),
  })
  .openapi("Error");

export type ErrorBody = z.infer<typeof ErrorSchema>;

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly issues: Issue[] | undefined;

  constructor(code: ErrorCode, message: string, issues?: Issue[]) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.issues = issues;
  }

  get status(): ContentfulStatusCode {
    return STATUS[this.code];
  }
}

export const errorBody = (code: ErrorCode, message: string, issues?: Issue[]): ErrorBody => ({
  error: issues?.length ? { code, message, issues } : { code, message },
});

export const issuesOf = (error: ZodError): Issue[] =>
  error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));

export const sendError = (c: Context, code: ErrorCode, message: string, issues?: Issue[]) =>
  c.json(errorBody(code, message, issues), STATUS[code]);

/** The app's onError: known errors keep their status, anything else is logged and answered 500. */
export const handleError = (err: Error, c: Context) => {
  if (err instanceof ApiError) return sendError(c, err.code, err.message, err.issues);
  if (err instanceof HTTPException && err.status < 500) {
    const code = err.status === 413 ? "payload_too_large" : "bad_request";
    return sendError(c, code, err.message || "Bad request");
  }
  console.error(err);
  return sendError(c, "internal", "Internal server error");
};

/** Shared OpenAPI response entries for the error answers. */
export const errorResponses = (...codes: ErrorCode[]) =>
  Object.fromEntries(
    codes.map((code) => [
      STATUS[code],
      { description: code, content: { "application/json": { schema: ErrorSchema } } },
    ]),
  );
