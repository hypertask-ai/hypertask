const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/loadModule.cjs");

function loadAuth(clientId = "google-client-fixture", clientSecret = "google-secret-fixture") {
  const captured = [];
  const auth = {};
  const plugin = () => ({});
  const stubs = {
    "better-auth": { betterAuth: options => { captured.push(options); return auth; } },
    "better-auth/adapters/prisma": { prismaAdapter: plugin },
    "better-auth/plugins": { emailOTP: plugin, magicLink: plugin, multiSession: plugin },
    "@better-auth/api-key": { apiKey: () => ({ schema: { apikey: { fields: { referenceId: {} } } } }) },
    "@better-auth/infra": { dash: plugin },
    "@better-auth/passkey": { passkey: plugin },
    "better-auth/api": { createAuthMiddleware: handler => handler },
    "@/lib/telemetry/analyticsIntents": {},
    "@/lib/auth/signupAttributionContext": {},
    "@/lib/telemetry/signupIdentityLink": {},
    "@/lib/auth/oauthTokenCipher": {},
    "@/lib/auth/oauthTokenStorage": {},
    "@/lib/auth/bridgePlugin": { bridgeSessionPlugin: plugin },
    "@/lib/configs/auth.config": {},
    "@/lib/auth/legacyCookiePlugin": { legacyCookiePlugin: plugin },
    "@/lib/email/sendEmail": {},
    "@/lib/mcp/managementPermissions": { MANAGEMENT_KEY_PERMISSIONS: {} },
    "@/lib/prisma": {},
    "@/lib/telemetry/signupAnalytics": {},
    "@/lib/telemetry/signupCompleted": {},
    "@/utils/controllers/users/provisionNewUser": {},
    "@/utils/controllers/users/resumeIncompleteSignup": {},
    crypto: require("node:crypto"),
  };
  const previous = { GOOGLE_ID: process.env.GOOGLE_ID, GOOGLE_SECRET: process.env.GOOGLE_SECRET };
  try {
    process.env.GOOGLE_ID = clientId;
    process.env.GOOGLE_SECRET = clientSecret;
    const loaded = loadModule("src/lib/auth/betterAuth.ts", stubs);
    assert.equal(loaded.auth, auth);
    assert.equal(captured.length, 1);
    return captured[0];
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

for (const suffix of ["first", "second"]) {
  test(`Google sign-up uses the configured credentials: ${suffix}`, () => {
    const options = loadAuth(`client-${suffix}`, `secret-${suffix}`);
    assert.equal(options.socialProviders.google.clientId, `client-${suffix}`);
    assert.equal(options.socialProviders.google.clientSecret, `secret-${suffix}`);
    assert.equal(Object.hasOwn(options.socialProviders.google, "disableSignUp"), false);
  });
}

test("Google account linking trusts the provider and retains the strict default gate", () => {
  const options = loadAuth();
  assert.deepEqual(options.account.accountLinking.trustedProviders, ["google"]);
  assert.equal(Object.hasOwn(options.account.accountLinking, "requireLocalEmailVerified"), false);
});
