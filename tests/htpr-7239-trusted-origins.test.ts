import assert from "node:assert/strict";
import test from "node:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";

import { betterAuthTrustedOrigins } from "@/lib/auth/trustedOrigins";

const DEPLOYMENT_HOST = "hypertasks-prod-abc123-hypertaskai.vercel.app";
const PRODUCTION_ENV = {
  VERCEL_ENV: "production",
  VERCEL_URL: DEPLOYMENT_HOST,
};

async function signOutStatusFrom(origin: string, env: typeof PRODUCTION_ENV) {
  const auth = betterAuth({
    baseURL: "https://app.hypertask.ai",
    secret: "htpr-7239-test-secret-at-least-32-chars",
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    trustedOrigins: betterAuthTrustedOrigins(env),
    logger: { disabled: true },
  });
  const response = await auth.handler(
    new Request("https://app.hypertask.ai/api/auth/sign-out", {
      method: "POST",
      headers: { origin, cookie: "better-auth.session_token=none", "content-type": "application/json" },
      body: "{}",
    }),
  );
  const body = await response.text();
  return { status: response.status, invalidOrigin: body.includes("INVALID_ORIGIN") };
}

test("production trusts the deployment's own vercel.app URL", async () => {
  const result = await signOutStatusFrom(`https://${DEPLOYMENT_HOST}`, PRODUCTION_ENV);
  assert.equal(result.invalidOrigin, false, `status ${result.status}`);
});

test("production still trusts app.hypertask.ai", async () => {
  const result = await signOutStatusFrom("https://app.hypertask.ai", PRODUCTION_ENV);
  assert.equal(result.invalidOrigin, false, `status ${result.status}`);
});

test("production still refuses other origins, including other vercel.app deployments", async () => {
  for (const origin of ["https://evil.example", "https://hypertasks-prod-other99-hypertaskai.vercel.app"]) {
    const result = await signOutStatusFrom(origin, PRODUCTION_ENV);
    assert.equal(result.status, 403, origin);
    assert.equal(result.invalidOrigin, true, origin);
  }
});

test("production without Vercel env trusts only the Hypertask domains", () => {
  assert.deepEqual(betterAuthTrustedOrigins({}), [
    "https://app.hypertask.ai",
    "https://staging.hypertask.ai",
    "https://demo.hypertask.ai",
  ]);
});

test("preview keeps demo plus its own deployment and branch URLs", () => {
  assert.deepEqual(
    betterAuthTrustedOrigins({
      VERCEL_ENV: "preview",
      VERCEL_URL: "pr-1.vercel.app",
      VERCEL_BRANCH_URL: "pr-branch.vercel.app",
    }),
    ["https://demo.hypertask.ai", "https://pr-1.vercel.app", "https://pr-branch.vercel.app"],
  );
});
