// Writes the API contract to openapi.json at the repository root, the file the web app generates its client from.
// `pnpm openapi` writes it; `pnpm openapi --check` (CI) fails when the committed file is out of date.
import { readFile, writeFile } from "node:fs/promises";
import { createApp, OPENAPI_INFO } from "../src/app.ts";
import { readEnv } from "../src/env.ts";
import { MemoryRateCache } from "../src/rates/cache.ts";
import { RatesService } from "../src/rates/service.ts";
import { memoryStore } from "../src/store/memory.ts";

const app = createApp({
  env: readEnv({}),
  store: memoryStore(),
  rates: new RatesService({ fetcher: fetch, cache: new MemoryRateCache() }),
  verifier: { verify: () => Promise.reject(new Error("not used")) },
});
const res = await app.request("/api/openapi.json");
const doc = (await res.json()) as Record<string, unknown>;
const text = `${JSON.stringify({ ...doc, info: OPENAPI_INFO.info }, null, 2)}\n`;
const file = new URL("../openapi.json", import.meta.url);

if (process.argv.includes("--check")) {
  const current = await readFile(file, "utf8").catch(() => "");
  if (current.replace(/\r\n/g, "\n") !== text) {
    console.error("openapi.json is out of date: run `pnpm openapi` and commit it.");
    process.exit(1);
  }
  console.log("openapi.json is up to date.");
} else {
  await writeFile(file, text);
  console.log("Wrote openapi.json");
}
