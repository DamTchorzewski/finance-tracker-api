## About

**finance-tracker-api** is the REST API of the finance tracker, version 2 of the personal finance app: the signed-in
user's profile now, and accounts, categories, transactions, budgets and currency rates as the work goes on. It runs on
Google Cloud Run, signs users in with Firebase Authentication and keeps the data in Firestore. The web app is
[`finance-tracker`](https://github.com/DamTchorzewski/finance-tracker); its plan is
[docs/redesign-plan.md](https://github.com/DamTchorzewski/finance-tracker/blob/develop/docs/redesign-plan.md) there.

- **Contract first.** Every route is declared with a Zod schema (`@hono/zod-openapi`); the OpenAPI 3.1 document is
  generated from them, served at `/api/openapi.json` with an interactive reference at `/api/docs`, and committed as
  `openapi.json`, from which the web app generates its typed client.
- **Signed in on every request.** The Firebase ID token in `Authorization: Bearer` is verified on each call; an
  unconfirmed e-mail address is refused (`REQUIRE_VERIFIED_EMAIL`).
- **One error shape.** `{ "error": { "code", "message", "issues"? } }`, with one issue per wrong field on a 400.
- **Guard rails.** A per-user rate limit (`RATE_LIMIT_PER_MINUTE`), a 256 kB body limit, security headers,
  `Cache-Control: private, no-store` on every answer, CORS off unless `CORS_ORIGIN` lists an origin.
- **Profile.** `GET /api/me` and `PATCH /api/me/profile`: base currency, language, the day the budget month starts,
  theme, accent hue, privacy mode and the order of the dashboard widgets.
- **Its own data.** Version 2 writes under `apps/finance-tracker/users/{uid}` in Firestore, apart from version 1, so
  the old app keeps working with the same sign-in accounts.

> **Status:** version 2 in progress (2026-11-21). Done: the foundations and the profile. Next: accounts, categories,
> transactions, budgets, the NBP / ECB rates and the import from version 1. Version 1 of this API is
> [`personal-finance-manager-api`](https://github.com/DamTchorzewski/personal-finance-manager-api), from which this
> repository was copied with its history.

## Tech stack

|          |                                                                                    |
| -------- | ---------------------------------------------------------------------------------- |
| Stack    | Node.js 22.18+ running TypeScript directly (type stripping, no build step), Hono 4 |
| Contract | Zod 4, `@hono/zod-openapi` (OpenAPI 3.1), Scalar API reference                     |
| Auth     | Firebase Authentication, ID tokens verified with Firebase Admin                    |
| Data     | Cloud Firestore (Firebase Admin)                                                   |
| Tests    | Vitest against the app with a fake token verifier and an in-memory store           |
| Hosting  | Google Cloud Run (europe-west1, min 0 / max 2 instances), built from the source    |

Code, comments, commits and the README are in English; `docs/` is in Polish (the owner reads it).

## Quick start

```bash
git clone https://github.com/DamTchorzewski/finance-tracker-api.git
cd finance-tracker-api
pnpm install
cp .env.example .env   # FIREBASE_PROJECT_ID and GOOGLE_APPLICATION_CREDENTIALS, or the emulator hosts
pnpm dev               # http://localhost:8080/api/health, docs at /api/docs
```

Requirements: Node.js 22.18 or newer (`.nvmrc`: 22) and pnpm 11.18 (`packageManager`).

## Scripts

| Command                        | Does                                                                      |
| ------------------------------ | ------------------------------------------------------------------------- |
| `pnpm dev`                     | the API with reload on change, reading `.env`                             |
| `pnpm start`                   | the API as Cloud Run starts it                                            |
| `pnpm check`                   | `format:check`, `lint`, `typecheck` and `test`: run before a pull request |
| `pnpm test`                    | unit tests (Vitest)                                                       |
| `pnpm openapi`                 | writes `openapi.json`; `--check` fails when it is out of date (CI)        |
| `pnpm health`                  | read-only check of a live API (`API_URL`)                                 |
| `pnpm format`, `pnpm lint:fix` | fix formatting and lint                                                   |

## Configuration

All variables, names only, are in [`.env.example`](.env.example); the defaults are in `src/env.ts`. None is a secret.

| Variable                 | What it does                                                          |
| ------------------------ | --------------------------------------------------------------------- |
| `FIREBASE_PROJECT_ID`    | the Firebase / Google Cloud project; set on Cloud Run by the deploy   |
| `CORS_ORIGIN`            | origins allowed from another origin (local web app); empty = CORS off |
| `REQUIRE_VERIFIED_EMAIL` | `false` lets in users with an unconfirmed e-mail address              |
| `RATE_LIMIT_PER_MINUTE`  | requests per user and minute, default 120                             |

## Structure

```
src/
  server.ts            starts the API with Firebase Admin (Cloud Run, local)
  app.ts             ★ the app: middleware, routes, the OpenAPI document
  env.ts               settings read from the environment
  lib/                 errors, sign-in middleware, rate limit
  routes/            ★ one file per resource (system, me)
  schemas/           ★ Zod schemas, the contract
  store/               storage interface; Firestore and in-memory implementations
  test/                test helpers (fake token verifier)
scripts/               write-openapi.ts, health-check.ts
openapi.json           the generated contract (committed)
docs/                  deployment and repository settings
```

## Branches and workflows

Shared standards from `reops/standards`: `main` ≤ `develop` ≤ a working branch `<type>/<topic>`, Conventional Commits in
English, `git.md` and `workflows.md`. `ci.yml` checks every pull request; `deploy.yml` runs CI on `develop` and `main`
and deploys `main` to Cloud Run with a health check; `weekly.yml` checks the live API every Monday.

**Departures from the standards (and why):**

- **No build step:** Node.js runs the TypeScript files itself (type stripping), so `build` is not a script; Cloud Run
  starts `pnpm start`.
- **No end-to-end tests:** an API without a browser; the routes are tested through the app in `pnpm test`. Tests
  against the Firebase emulators come with the Firestore resources.
- **No README images yet:** they wait for the version 2 brand (the logo is being designed).

## Documentation

| File                                     | What it covers                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| [docs/deployment.md](docs/deployment.md) | Google Cloud, Firebase and GitHub setup for version 2, the first deploy |
| [docs/repository.md](docs/repository.md) | GitHub description and topics, and the command that sets them           |

Author: [Damian Tchorzewski](https://github.com/DamTchorzewski). Licensed under the [MIT License](LICENSE).
