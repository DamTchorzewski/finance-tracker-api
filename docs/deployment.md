# Wdrożenie: Google Cloud Run, Firebase Authentication i Firestore (wersja 2)

API wersji 2 działa na **Cloud Run** jako usługa `finance-tracker-api` (kontener budowany przez Google z kodu, bez
Dockerfile), użytkownicy są w **Firebase Authentication**, dane w **Firestore**. Wszystko w tym samym projekcie Google co
wersja 1 (`personal-finance-manager-api`), która działa dalej bez zmian: wersja 2 ma własną usługę Cloud Run i własne
kolekcje (`apps/finance-tracker/users/{uid}`). Aplikacja (`finance-tracker`) stoi na **Firebase Hosting**, który
przekazuje adresy `/api/**` do tej usługi, więc API i strona są pod jednym adresem.

W API nie ma sekretu: na Cloud Run działa jako konto usługi `pfm-api` (dostęp do Firestore, założone dla wersji 1).
GitHub loguje się do Google przez Workload Identity Federation, bez klucza. Region: `europe-west1`.

Konfiguracja projektu Google, Firebase i kont usług z wersji 1 jest opisana w
[`personal-finance-manager-api/docs/deployment.md`](https://github.com/DamTchorzewski/personal-finance-manager-api/blob/main/docs/deployment.md);
poniżej tylko to, co dochodzi dla wersji 2.

## 1. Cloud Shell: dopuść nowe repozytoria (jednorazowo)

Konsola Google Cloud → **Activate Cloud Shell** (`>_`) → wpisz własny `PROJECT_ID` w pierwszej linii i wklej. Skrypt
pozwala nowym repozytoriom logować się do Google (dotąd mogło tylko `personal-finance-manager-api`) i daje kontu
wdrażającemu prawo do wdrażania Firebase Hosting (aplikacja) z przekierowaniem do Cloud Run.

```bash
PROJECT_ID="TU-WPISZ-PROJECT-ID"
OWNER="DamTchorzewski"

gcloud config set project "$PROJECT_ID"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
POOL="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github"
DEPLOY_SA="github-deployer@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud services enable firebasehosting.googleapis.com

# stare i nowe repozytoria mogą logować się przez GitHub Actions
gcloud iam workload-identity-pools providers update-oidc github-provider --location=global \
  --workload-identity-pool=github \
  --attribute-condition="assertion.repository in ['${OWNER}/personal-finance-manager-api', '${OWNER}/finance-tracker-api', '${OWNER}/finance-tracker']"
for REPO in finance-tracker-api finance-tracker; do
  gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --role="roles/iam.workloadIdentityUser" \
    --member="principalSet://iam.googleapis.com/${POOL}/attribute.repository/${OWNER}/${REPO}"
done

# wdrażanie Firebase Hosting; odczyt usług Cloud Run dla przekierowania /api/**
for ROLE in roles/firebasehosting.admin roles/run.viewer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${DEPLOY_SA}" --role="$ROLE"
done

echo
echo "GCP_PROJECT_ID=${PROJECT_ID}"
echo "GCP_REGION=europe-west1"
echo "GCP_SERVICE_ACCOUNT=${DEPLOY_SA}"
echo "GCP_WORKLOAD_IDENTITY_PROVIDER=${POOL}/providers/github-provider"
echo "API_RUNTIME_SERVICE_ACCOUNT=pfm-api@${PROJECT_ID}.iam.gserviceaccount.com"
```

„concurrent policy changes" przy `add-iam-policy-binding` to chwilowy konflikt: powtórz tę jedną komendę.

## 2. GitHub

Repozytorium `finance-tracker-api` → **Settings → Environments → New environment** → `production` (_Deployment branches:
Selected branches → `main`_). W tym środowisku **Variables** dodaj pięć zmiennych z końca skryptu: `GCP_PROJECT_ID`,
`GCP_REGION`, `GCP_SERVICE_ACCOUNT`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `API_RUNTIME_SERVICE_ACCOUNT`. To nie są sekrety.

Po pierwszym wdrożeniu: **Settings → Secrets and variables → Actions → Variables** (zmienna repozytorium) `API_URL` =
adres aplikacji na Firebase Hosting (albo adres usługi Cloud Run), dla cotygodniowej kontroli.

`CORS_ORIGIN` nie jest potrzebny: aplikacja woła `/api` pod własnym adresem.

## 3. Pierwsze wdrożenie i sprawdzenie

1. Wdrożenie rusza przy wydaniu (`develop` → `main`) albo ręcznie: Actions → **Build & Deploy** → _Run workflow_ na `main`.
2. Workflow kończy się sprawdzeniem `scripts/health-check.ts`: `/api/health` zwraca `{"status":"ok"}`, `/api/openapi.json`
   to kontrakt, `/api/me` bez tokenu odpowiada 401. Dokumentacja: `<adres>/api/docs`.
3. Aplikacja `finance-tracker` wdraża się swoim workflow (jej `docs/deployment.md`).

## Wycofanie

Cloud Run trzyma poprzednie wersje: konsola → Cloud Run → `finance-tracker-api` → **Revisions** → poprzednia →
_Manage traffic_ → 100 %. Albo `git revert` na gałęzi roboczej i zwykłe wydanie.

## Koszty i bezpieczeństwo

- `--min-instances=0`: pierwsze zapytanie po przerwie trwa dłużej (zimny start); `--max-instances=2` ogranicza koszt.
- Każda trasa poza `/api/health`, `/api/openapi.json` i `/api/docs` wymaga tokenu Firebase; limit zapytań na
  użytkownika; odpowiedzi z danymi mają `Cache-Control: private, no-store`, więc CDN Firebase Hosting ich nie zapamiętuje.
- Reguły Firestore zostają domyślne (odmowa dla wszystkich): dane czyta i zapisuje tylko API.
- Alert budżetu z wersji 1 obejmuje cały projekt, więc także wersję 2.
