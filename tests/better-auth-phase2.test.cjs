const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const betterAuthSrc = fs.readFileSync(
  path.join(root, "src/lib/auth/betterAuth.ts"),
  "utf8"
);
const betterAuthClientSrc = fs.readFileSync(
  path.join(root, "src/lib/auth/betterAuthClient.ts"),
  "utf8"
);
const loginMiddleSrc = fs.readFileSync(
  path.join(root, "src/app/login/LoginMiddle.tsx"),
  "utf8"
);
const emailAuthComponentsSrc = fs.readFileSync(
  path.join(root, "src/app/login/EmailAuth/EmailAuthComponents.tsx"),
  "utf8"
);
const legacyCookieSrc = fs.readFileSync(
  path.join(root, "src/lib/auth/legacyCookiePlugin.ts"),
  "utf8"
);
const emailAuthSrc = fs.readFileSync(
  path.join(root, "src/app/login/EmailAuth/useEmailAuth.ts"),
  "utf8"
);
const useAuthSrc = fs.readFileSync(
  path.join(root, "src/hooks/General/useAuth.tsx"),
  "utf8"
);
const firebaseClientSrc = fs.readFileSync(
  path.join(root, "src/firebase.ts"),
  "utf8"
);
const useSignoutSrc = fs.readFileSync(
  path.join(root, "src/hooks/MultiPages/HTC/useSignout.ts"),
  "utf8"
);
const useFcmTokenSrc = fs.readFileSync(
  path.join(root, "src/hooks/General/useFcmToken.tsx"),
  "utf8"
);

test("magicLink enables provisioned sign-up while emailOTP remains existing-user-only", () => {
  // HTPR-4166: verified magic-link users may self-register now that the Better
  // Auth create hook performs the legacy provisioning side effects.
  const magicLinkStart = betterAuthSrc.indexOf("magicLink(");
  const emailOtpStart = betterAuthSrc.indexOf("emailOTP(");
  assert.ok(magicLinkStart !== -1 && emailOtpStart !== -1, "both plugin calls must be present");

  assert.doesNotMatch(
    betterAuthSrc.slice(magicLinkStart, emailOtpStart),
    /disableSignUp:/,
    "magicLink plugin must allow sign-up"
  );
  assert.match(
    betterAuthSrc.slice(emailOtpStart),
    /disableSignUp:\s*true/,
    "emailOTP plugin must keep disableSignUp: true"
  );
});

test("Better Auth user creation supplies uid and runs verified provisioning", () => {
  assert.match(betterAuthSrc, /uid:\s*`ba_\$\{randomUUID\(\)\}`/);
  assert.match(betterAuthSrc, /await provisionNewUser\(\{/);
  assert.match(betterAuthSrc, /isVerified:\s*true/);
  assert.match(betterAuthSrc, /CRITICAL: Better Auth user provisioning failed/);
  assert.match(betterAuthSrc, /throw error/);
});

test("passkey sign-in stays production-bound and bridges into the legacy session", () => {
  assert.match(betterAuthSrc, /import \{ passkey \} from '@better-auth\/passkey'/);
  assert.match(betterAuthSrc, /origin: process\.env\.BETTER_AUTH_URL \?\? 'https:\/\/app\.hypertask\.ai'/);
  assert.match(betterAuthSrc, /schema: \{ passkey: \{ modelName: 'Passkey' \} \}/);
  assert.match(betterAuthClientSrc, /passkeyClient\(\)/);
  assert.match(
    loginMiddleSrc,
    /signIn\.passkey\(\)[\s\S]*bridge-legacy-session/
  );
  assert.match(
    emailAuthSrc,
    /signIn\.passkey\(\{ autoFill: true \}\)[\s\S]*bridge-legacy-session/
  );
  assert.match(emailAuthComponentsSrc, /autoComplete="username webauthn"/);
});

test("legacy cookie bridge mints every cookie the legacy app reads directly", () => {
  // HTPR-4146: 140+ files still read nookies_user/ht_session directly, bypassing
  // Better Auth's own session. If this plugin stops setting one of them, those
  // call sites silently see a logged-out user after a native BA login.
  for (const cookieName of ["nookies_user", "SESSION_COOKIE", "signup_source"]) {
    assert.match(
      legacyCookieSrc,
      new RegExp(`ctx\\.setCookie\\(\\s*(['"]?)${cookieName}\\1`),
      `legacyCookiePlugin must set the ${cookieName} cookie`
    );
  }
  assert.match(
    legacyCookieSrc,
    /ctx\.setCookie\(\s*authConfig\.cookies\.theme/,
    "legacyCookiePlugin must set the configured theme cookie"
  );

  assert.match(
    legacyCookieSrc,
    /ctx\.json\(\{\s*ok:\s*true,\s*hasProjects\s*\}\)/,
    "legacyCookiePlugin must report whether the user has projects"
  );
});

test("Better Auth magic-link sign-up never falls back to instant signup", () => {
  const recoveryEffect = emailAuthSrc.slice(
    emailAuthSrc.indexOf("if (urlParams.get('authError') !== 'account_not_found')"),
    emailAuthSrc.indexOf("const validateEmail")
  );

  assert.match(
    emailAuthSrc,
    /if \(isBetterAuthEnabled\) return\s+\n\s*const urlParams/,
    "flag-on must bypass the legacy instant-signup recovery effect"
  );
  assert.match(
    recoveryEffect,
    /fetch\('\/api\/auth\/instant-signup'/,
    "flag-off must retain the legacy instant-signup fallback"
  );
  assert.equal(
    emailAuthSrc.match(/authClient\.signIn\.magicLink\(/g)?.length,
    2,
    "submit and resend must both use Better Auth magic links"
  );
});

test("reverse bridge sends projectless users to onboarding", () => {
  assert.match(useAuthSrc, /const \{ hasProjects \} = await response\.json\(\)/);
  assert.match(
    useAuthSrc,
    /hasProjects === false \? '\/onboarding' : authConfig\.redirect\.afterLogin/
  );
});

test("client auth uses Better Auth while Firebase remains available only for messaging", () => {
  assert.doesNotMatch(firebaseClientSrc, /firebase\/auth|getAuth|GoogleAuthProvider/);
  assert.doesNotMatch(
    useAuthSrc,
    /firebase\/auth|signInWithCustomToken|getRedirectResult|pendingGoogleRedirect|googleRedirectContext/
  );
  assert.equal(
    useAuthSrc.match(/authClient\.signIn\.social\(/g)?.length,
    2,
    "both context Google entry points must use Better Auth"
  );
  assert.doesNotMatch(emailAuthSrc, /data\.customToken/);
  assert.doesNotMatch(useSignoutSrc, /@\/firebase|NEXT_PUBLIC_BETTER_AUTH_ENABLED/);
  assert.match(useSignoutSrc, /signOutAllAccounts\(\)/);
  assert.match(useFcmTokenSrc, /import\('firebase\/messaging'\)/);
  assert.match(useFcmTokenSrc, /import\('@\/firebase'\)/);
  assert.match(useFcmTokenSrc, /getMessaging\(app\)/);
});
