const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const betterAuthSrc = fs.readFileSync(
  path.join(root, "src/lib/auth/betterAuth.ts"),
  "utf8"
);
const loginButtonSrc = fs.readFileSync(
  path.join(root, "src/app/login/LoginButton.tsx"),
  "utf8"
);
const useAuthSrc = fs.readFileSync(
  path.join(root, "src/hooks/General/useAuth.tsx"),
  "utf8"
);

test("Google is configured as a sign-up-capable social provider", () => {
  const socialProvidersBlock = betterAuthSrc.match(
    /socialProviders:\s*\{([\s\S]*?)\n\s*\},\n\s*user:/
  );
  assert.ok(socialProvidersBlock, "socialProviders block must be present");

  const googleBlock = socialProvidersBlock[1].match(
    /google:\s*\{([\s\S]*?)\n\s*\},/
  );
  assert.ok(googleBlock, "google block must be inside socialProviders");

  assert.match(
    googleBlock[1],
    /clientId:\s*process\.env\.GOOGLE_ID\s+as\s+string/,
    "Google clientId must come from process.env.GOOGLE_ID"
  );
  assert.match(
    googleBlock[1],
    /clientSecret:\s*process\.env\.GOOGLE_SECRET\s+as\s+string/,
    "Google clientSecret must come from process.env.GOOGLE_SECRET"
  );
  assert.doesNotMatch(
    googleBlock[1],
    /disableSignUp:/,
    "Google provider must allow sign-up"
  );
});

test("Google account linking trusts the provider without legacy local verification", () => {
  const accountLinkingBlock = betterAuthSrc.match(
    /accountLinking:\s*\{([\s\S]*?)\n\s*\},/
  );
  assert.ok(accountLinkingBlock, "accountLinking block must be present");

  assert.match(
    accountLinkingBlock[1],
    /trustedProviders:\s*\[[^\]]*['"]google['"][^\]]*\]/,
    "accountLinking must trust Google"
  );
  assert.doesNotMatch(
    accountLinkingBlock[1],
    /requireLocalEmailVerified/,
    "the strict default gate must stay on after the HTPR-4159 backfill"
  );
});

test("Google sign-up stays in Better Auth without automatic Firebase fallback", () => {
  assert.match(
    loginButtonSrc,
    /errorCallbackURL: "\/login\?authError=google_signup_disabled"/,
    "keep the shared OAuth error landing surface"
  );
  assert.doesNotMatch(useAuthSrc, /hasFallenBackToLegacyGoogleSignup/);
  assert.doesNotMatch(useAuthSrc, /void loginWithGoogle\(\)/);
});
