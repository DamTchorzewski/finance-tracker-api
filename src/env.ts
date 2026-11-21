// Settings read from the environment once at start. Names and meaning: .env.example.
export interface Env {
  port: number;
  /** Web origins allowed to call the API from another origin (local development). Empty = CORS off. */
  corsOrigins: string[];
  /** Firebase / Google Cloud project; empty = the project of the credentials (Cloud Run). */
  projectId: string | undefined;
  /** Users must confirm their e-mail address before they can use the API. */
  requireVerifiedEmail: boolean;
  /** Requests per minute and user before 429. */
  rateLimitPerMinute: number;
  /** The running revision, shown by /api/health. */
  version: string;
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return {
    port: Number(source.PORT) || 8080,
    corsOrigins: (source.CORS_ORIGIN ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    projectId: source.FIREBASE_PROJECT_ID || undefined,
    requireVerifiedEmail: source.REQUIRE_VERIFIED_EMAIL !== "false",
    rateLimitPerMinute: Number(source.RATE_LIMIT_PER_MINUTE) || 120,
    version: source.K_REVISION ?? "local",
  };
}
