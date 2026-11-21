# Repozytorium: opis i tagi

Rzeczy, które ustawia się na GitHubie ręcznie (nie da się ich zapisać w plikach repozytorium). Przegląd projektu:
[README](../README.md).

## Nazwa repozytorium: `finance-tracker-api`

Standard nazw: `reops/standards/repo-names.md`. To API wersji 2 aplikacji finansowej (aplikacja: `finance-tracker`).
Repozytorium powstało 2026-11-21 jako kopia, z całą historią, repozytorium `personal-finance-manager-api` (wersja 1,
które zostaje bez zmian); wcześniej to repozytorium nazywało się `wallet`. Rola, `-api`, jest na końcu nazwy.

## Opis i tagi (About)

**Opis (Description):**

```text
REST API of a personal finance tracker: TypeScript, Hono, Zod and OpenAPI 3.1, Firebase Auth and Firestore, on Google Cloud Run.
```

**Tagi (Topics):**

```text
typescript hono zod openapi rest-api firebase firebase-auth firestore google-cloud cloud-run personal-finance nodejs
```

Z GitHub CLI (`gh`) jedną komendą:

```bash
gh repo edit DamTchorzewski/finance-tracker-api --description "REST API of a personal finance tracker: TypeScript, Hono, Zod and OpenAPI 3.1, Firebase Auth and Firestore, on Google Cloud Run." --add-topic typescript --add-topic hono --add-topic zod --add-topic openapi --add-topic rest-api --add-topic firebase --add-topic firebase-auth --add-topic firestore --add-topic google-cloud --add-topic cloud-run --add-topic personal-finance --add-topic nodejs
```

## Ustawienia do włączenia

| Gdzie (GitHub)                               | Co ustawić                                                           |
| -------------------------------------------- | -------------------------------------------------------------------- |
| Settings → General → Default branch          | `main` (już jest)                                                    |
| Settings → Environments → `production`       | zmienne wdrożenia na Cloud Run, patrz [deployment.md](deployment.md) |
| Settings → Secrets and variables → Variables | `API_URL` dla cotygodniowej kontroli                                 |
| Settings → Code security                     | Dependabot alerts i secret scanning (`standards/github-settings.md`) |
