
type FirebaseServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
  [key: string]: unknown;
};

let cached: FirebaseServiceAccount | undefined;

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
