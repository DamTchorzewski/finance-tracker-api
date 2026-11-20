<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/banner-dark.png">
    <img src="docs/images/banner-light.png" alt="Personal Finance Manager API: authentication, transactions and Swagger docs" width="100%">
  </picture>
</p>

<p align="center">
  <img src="docs/images/showcase.jpg" alt="The Swagger documentation of the API, served at /api-docs" width="100%">
</p>

## About

**Personal Finance Manager API** is the REST API behind the
[Personal Finance Manager](https://github.com/DamTchorzewski/personal-finance-manager) web app. It registers users with
an e-mail confirmation, signs them in with JWT tokens, and stores each user's income and expense transactions.

- **Accounts.** Registration, login, logout and the current user. A new user gets a verification token by e-mail and
  can log in only after confirming it; the confirmation e-mail can be sent again.
- **Transactions.** Create, list, update and delete the transactions of the signed-in user, newest first; each
  transaction has a type (`+` or `-`), a category, a date, a comment and a sum. A user sees only their own.
- **Security.** Passwords are hashed with bcrypt; an access token lives one hour and must also match the token stored
  for the user, so logging out ends the session.
- **Validation.** Request bodies are validated with Joi and answered with one error format: `status`, `statusText`
  and `result.message`.
- **Documented.** Swagger UI at `/api-docs`, from `src/docs/swagger.json` (OpenAPI 3).

| Method and path                         | Auth | What it does                               |
| --------------------------------------- | :--: | ------------------------------------------ |
| `POST /api/users/register`              |      | create a user and send the verification e-mail |
| `POST /api/users/login`                 |      | sign in, returns a token                   |
| `POST /api/users/logout`                | yes  | sign out                                   |
| `POST /api/users/reverify`              |      | send the verification e-mail again         |
| `GET /api/users/verify/:token`          |      | confirm the e-mail address                 |
| `GET /api/users/current`                | yes  | the signed-in user                         |
| `GET /api/transactions`                 | yes  | the user's transactions                    |
| `POST /api/transactions`                | yes  | add a transaction                          |
| `PUT /api/transactions/:id`             | yes  | update a transaction                       |
| `DELETE /api/transactions/:id`          | yes  | delete a transaction                       |
| `GET /api/transactions/categories/:id`  | yes  | the category of a transaction              |

> **Status:** the link in the verification e-mail points at `wallet-sdqv.onrender.com` (a constant in
> `src/utils/sendMail.js`), and the Swagger server list names the same host. There are no automated tests.

## Tech stack

|          |                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------- |
| Stack    | Node.js (ES modules), Express 4                                                                   |
| Data     | MongoDB with Mongoose 7                                                                           |
| Auth     | Passport (JWT strategy), `jsonwebtoken`, `bcryptjs`                                               |
| Services | Nodemailer (SMTP) for the verification e-mail; Joi for validation                                 |
| Docs     | Swagger UI (`swagger-ui-express`), OpenAPI 3                                                      |
| Tests    | none                                                                                              |
| Hosting  | any Node.js host with a MongoDB database; `npm start` runs the server                             |

The messages, code and commits are in English.

## Screenshots

<p align="center">
  <img src="docs/images/docs.jpg" alt="The Users and Transactions groups of the Swagger documentation" width="100%">
</p>

The images are the Swagger UI served by the app itself (it needs no database). An API has no other screen, so there is
no phone view.

## Quick start

```bash
git clone https://github.com/DamTchorzewski/personal-finance-manager-api.git
cd personal-finance-manager-api
npm install
cp .env.example .env      # fill in the values
npm run dev               # http://localhost:<PORT>/api-docs
```

Requirements: Node.js 18 LTS or newer, npm, a MongoDB database and an SMTP account for the verification e-mails.

## Scripts

| Command            | What it does                                                         |
| ------------------ | -------------------------------------------------------------------- |
| `npm start`        | production server (`NODE_ENV=production`)                            |
| `npm run dev`      | development server with `nodemon`                                    |
| `npm run lint`     | ESLint over the sources                                              |
| `npm run lint:fix` | ESLint with automatic fixes                                          |

## Configuration

The file is `.env.example` (names only, copy it to `.env`):

| Variable                                          | What it is                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| `PORT`                                            | port the API listens on (required)                                 |
| `DB_HOST`                                         | MongoDB connection string (secret, required)                       |
| `SECRET_KEY`                                      | secret that signs and checks the JWT tokens (secret, required)     |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_KEY` | the SMTP account that sends the verification e-mails (secrets)     |

## Structure

```
src/server.js          ★ connects to MongoDB and starts the app
src/app.js             Express app: Swagger UI, CORS, the routers, the error handlers
src/routes/            users.js and transactions.js: the routes and their middleware
src/controllers/       request handling: validation, status codes, the response format
src/services/          the database queries
src/models/            Mongoose schemas: users, transactions
src/middlewares/       auth.js: the JWT check
src/config/            passport.js: the JWT strategy
src/utils/             bcrypt, validation (Joi), sendMail (Nodemailer), error helpers
src/docs/              swagger.json: the OpenAPI description
docs/                  repository description; docs/images/ holds the README images (generated)
```

## Branches and workflows

Shared standards from `reops/standards`: `main` ≤ `develop` ≤ a working branch `<type>/<topic>`, Conventional
Commits in English. The repository has no workflows. Details: `reops/standards/git.md`.

**Departures from the standards (and why):**

- **No CI, no tests, no hooks:** a small back end; the checks are `npm run lint` and the Swagger UI.
- **npm, not pnpm, and no `.nvmrc`:** the project predates the standards.
- **README images** are made by `tools/readme-images` (profile `personal-finance-manager-api`) from the Swagger UI the
  app serves locally; the logo is a wordmark, and there is no "Open site" button and no phone strip.
- **No DamReboot footer:** not a company product.

## Documentation

| File                                     | What it covers                                                |
| ---------------------------------------- | ------------------------------------------------------------- |
| [docs/repository.md](docs/repository.md) | GitHub description and topics, and the command that sets them |

The README images (`docs/images/`) are regenerated with `tools/readme-images`, profile `personal-finance-manager-api`; the working shots go to `.scratch/`.

Author: [Damian Tchorzewski](https://github.com/DamTchorzewski). Licensed under the [MIT License](LICENSE).
