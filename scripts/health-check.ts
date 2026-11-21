// Read-only check of the live API: /api/health answers 200 with status "ok" and the contract is published.
// API_URL is the origin, e.g. the Cloud Run URL or the web app's address (Firebase Hosting rewrites /api).
// Run after every deploy and by the weekly check; exit 1 on failure. Standard: reops/standards/workflows.md
const origin = (process.env.API_URL ?? process.argv[2] ?? "").replace(/\/+$/, "");
if (!origin) {
  console.error("Set API_URL (or pass the origin as the first argument).");
  process.exit(1);
}

const failures: string[] = [];

async function check(path: string, test: (res: Response) => Promise<string | null>) {
  try {
    const res = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(20_000) });
    const problem = await test(res);
    console.log(`${problem ? "FAIL" : "ok  "} ${path}${problem ? `: ${problem}` : ""}`);
    if (problem) failures.push(`${path}: ${problem}`);
  } catch (err) {
    console.log(`FAIL ${path}: ${(err as Error).message}`);
    failures.push(`${path}: ${(err as Error).message}`);
  }
}

await check("/api/health", async (res) => {
  if (res.status !== 200) return `HTTP ${res.status}`;
  const body = (await res.json()) as { status?: string };
  return body.status === "ok" ? null : `status ${body.status}`;
});
await check("/api/openapi.json", async (res) => {
  if (res.status !== 200) return `HTTP ${res.status}`;
  const body = (await res.json()) as { openapi?: string };
  return body.openapi?.startsWith("3.") ? null : "not an OpenAPI document";
});
await check("/api/me", (res) =>
  Promise.resolve(res.status === 401 ? null : `expected 401 without a token, got ${res.status}`),
);

if (failures.length) process.exit(1);
