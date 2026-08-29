// Loads the Firebase Admin service-account credential from the
// FIREBASE_SERVICE_ACCOUNT_B64 env var (base64-encoded service-account JSON).
//
// This credential used to live in a committed src/service_key.json file, which
// meant a live production admin key was sitting in git history. It was rotated
// and moved to an env var for security (HTPR-3810). Set the env var to the
// base64 of the service-account JSON on every environment that needs Firebase
// Admin (Vercel production + preview, and your local .env for dev).

type FirebaseServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
  [key: string]: unknown;
};

let cached: FirebaseServiceAccount | undefined;

// Returns `any` to match the shape firebase-admin's credential.cert() expects at
// runtime (it accepts the raw snake_case service-account JSON), mirroring the
// original `require('@/service_key.json')` which was also untyped.
export function getFirebaseServiceAccount(): any {
  if (cached) return cached;

  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_B64 is not set. Provide the base64-encoded Firebase Admin service-account JSON (see HTPR-3810).",
    );
  }

  let parsed: FirebaseServiceAccount;
  try {
    parsed = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch (err) {
    throw new Error(
      `FIREBASE_SERVICE_ACCOUNT_B64 is not valid base64-encoded JSON: ${(err as Error).message}`,
    );
  }

  if (!parsed.private_key || !parsed.client_email || !parsed.project_id) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_B64 is missing required fields (project_id, client_email, private_key).",
    );
  }

  cached = parsed;
  return cached;
}
