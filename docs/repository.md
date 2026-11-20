# Repozytorium: opis i tagi

Rzeczy, które ustawia się na GitHubie ręcznie (nie da się ich zapisać w plikach repozytorium). Przegląd projektu: [README](../README.md).

## Nazwa repozytorium: `personal-finance-manager-api`

Standard nazw repozytoriów: `reops/standards/repo-names.md`. Repozytorium nazywało się wcześniej `wallet`; od 2026-11-20 nazywa się `personal-finance-manager-api` (nazwa mówi, czym jest projekt: fraza szukana na GitHubie; rola, `-api`, jest na końcu, jak w standardzie). To API aplikacji z repozytorium `personal-finance-manager`. GitHub przekierowuje stary adres repozytorium. Instancja, z którą łączy się aplikacja (`wallet-sdqv.onrender.com`), jest podpięta do repozytorium w panelu hostingu: po zmianie nazwy sprawdź, że wdrożenia nadal się uruchamiają.

## Opis i tagi (About)

GitHub: strona repozytorium → ⚙ obok „About” → pola poniżej. Opis ma limit 350 znaków, tagi (topics) pisze się małymi literami z myślnikami, najwyżej 20.

**Opis (Description):**

```text
REST API for a personal finance app: Node.js, Express, MongoDB, JWT authentication and Swagger docs.
```

**Tagi (Topics):**

```text
nodejs express mongodb mongoose rest-api jwt passport swagger openapi personal-finance nodemailer joi
```

Z GitHub CLI (`gh`) to samo jedną komendą:

```bash
gh repo edit DamTchorzewski/personal-finance-manager-api --description "REST API for a personal finance app: Node.js, Express, MongoDB, JWT authentication and Swagger docs." --add-topic nodejs --add-topic express --add-topic mongodb --add-topic mongoose --add-topic rest-api --add-topic jwt --add-topic passport --add-topic swagger --add-topic openapi --add-topic personal-finance --add-topic nodemailer --add-topic joi
```

## Ustawienia do włączenia

| Gdzie (GitHub)                      | Co ustawić                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| Settings → General → Default branch | `main` (już jest)                                                                 |
| Hosting (Render)                    | połączenie z repozytorium po zmianie nazwy: sprawdź, że kolejny push uruchamia wdrożenie |
