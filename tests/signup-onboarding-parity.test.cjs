// HTPR-5639: a new account must land on its board no matter which sign-up door
// it came through. Better Auth (Google, passkey, magic link, email+password)
// hardcoded the onboarding flags to false while the email-code path passed the
// shared config, so one real customer got the /onboarding wizard and the next
// test signup did not. These tests pin both halves of that split.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function loadTs(relativePath) {
  const jiti = require("jiti")(path.join(__dirname, "signup-onboarding-parity.test.cjs"), {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  });
  return jiti(path.join(root, relativePath));
}

const authConfig = loadTs("src/lib/configs/auth.config.ts");
const authService = loadTs("src/lib/services/authService.ts");

const betterAuthSource = fs.readFileSync(
  path.join(root, "src/lib/auth/betterAuth.ts"),
  "utf8"
);

const getRedirectUrl =
  authService.getRedirectUrl ??
  authService.default?.getRedirectUrl ??
  authService.AuthService?.getRedirectUrl ??
  authService.default?.AuthService?.getRedirectUrl;

test("config says new signups skip the wizard and the tutorial", () => {
  assert.equal(authConfig.onboarding.skipOnboarding, true);
  assert.equal(authConfig.onboarding.shouldSkipInteractive, true);
});

test("Better Auth signups provision from the shared config, never hardcoded flags", () => {
  const hook = betterAuthSource.slice(
    betterAuthSource.indexOf("await provisionNewUser({")
  );
  const call = hook.slice(0, hook.indexOf("})"));

  assert.match(call, /skipOnboarding:\s*authConfig\.onboarding\.skipOnboarding/);
  assert.match(
    call,
    /shouldSkipInteractive:\s*authConfig\.onboarding\.shouldSkipInteractive/
  );
  assert.doesNotMatch(
    call,
    /skipOnboarding:\s*false/,
    "hardcoding false here is what sent Google signups to /onboarding"
  );
});

test("a user provisioned with the config lands on the board, not the wizard", () => {
  if (typeof getRedirectUrl !== "function") {
    throw new Error("getRedirectUrl not exported from authService");
  }
  // onboardingTourStatus is written straight from skipOnboarding by
  // provisionNewUser, so the config value IS what routing sees.
  const onboarded = {
    UserSetting: { onboardingTourStatus: authConfig.onboarding.skipOnboarding },
  };
  const board = { id: 42, team: { id: 7, title: "MyTeam" } };

  const target = getRedirectUrl(onboarded, board, false);

  assert.equal(target, "/project?id=42");
  assert.doesNotMatch(target, /\/onboarding/);
});

test("an account still flagged un-onboarded keeps getting the wizard", () => {
  const notOnboarded = { UserSetting: { onboardingTourStatus: false } };
  const board = { id: 42, team: { id: 7, title: "MyTeam" } };

  const target = getRedirectUrl(notOnboarded, board, false);

  assert.match(target, /^\/onboarding\?projectId=42/);
});
