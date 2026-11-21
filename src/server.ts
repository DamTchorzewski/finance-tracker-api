import { serve } from "@hono/node-server";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { createApp } from "./app.ts";
import { readEnv } from "./env.ts";
import { FirestoreRateCache } from "./rates/cache.ts";
import { RatesService } from "./rates/service.ts";
import { firestoreStore } from "./store/firestore.ts";

// On Cloud Run the API runs as its service account, so there is no key. Locally: GOOGLE_APPLICATION_CREDENTIALS, or
// FIREBASE_AUTH_EMULATOR_HOST and FIRESTORE_EMULATOR_HOST for the emulators (.env.example).
const env = readEnv();
const firebase = initializeApp(env.projectId ? { projectId: env.projectId } : undefined);
const auth = getAuth(firebase);
const db = getFirestore(firebase);
db.settings({ ignoreUndefinedProperties: true });

const app = createApp({
  env,
  store: firestoreStore(db),
  rates: new RatesService({ fetcher: fetch, cache: new FirestoreRateCache(db) }),
  verifier: {
    async verify(token) {
      const decoded = await auth.verifyIdToken(token);
      return {
        uid: decoded.uid,
        email: decoded.email ?? null,
        name: (decoded.name as string | undefined) ?? null,
        emailVerified: decoded.email_verified === true,
      };
    },
  },
});

// A library promise that fails outside a request (the Firestore client retries in the background) is logged, not
// allowed to stop the server for every user. A real bug still shows in the logs of Cloud Run.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason instanceof Error ? reason.message : reason);
});

serve({ fetch: app.fetch, port: env.port }, ({ port }) => {
  console.log(`Finance tracker API listening on port ${port}`);
});
