const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loader } = require("./helpers/htpr-7260-ui.cjs");
const { NextResponse } = require("next/server");

const root = path.resolve(__dirname, "..");
const signoutSource = fs.readFileSync(
  path.join(root, "src/hooks/MultiPages/HTC/useSignout.ts"),
  "utf8",
);
const forceSignoutSource = fs.readFileSync(
  path.join(root, "src/app/api/auth/force-signout/route.ts"),
  "utf8",
);
const purchasePlanSource = fs.readFileSync(
  path.join(root, "src/components/Modals/PurchasePlan/index.tsx"),
  "utf8",
);

const accountsSource = fs.readFileSync(path.join(root, "src/lib/auth/accounts.ts"), "utf8");

test("hard reset uses the browser cookie cleanup endpoint even when Better Auth is unavailable", () => {
  assert.match(signoutSource, /await signOutAllAccounts\(\)/);
  assert.doesNotMatch(signoutSource, /if \(!\(await signOutAllAccounts\(\)\)\)/);
  assert.match(accountsSource, /fetch\("\/api\/auth\/force-signout"/);
  assert.match(forceSignoutSource, /auth\.api\.signOut[\s\S]*\.catch\(\(error\) =>/);
  assert.match(signoutSource, /window\.location\.href = "\/login"/);

  const serverCleanup = signoutSource.indexOf(
    'await signOutAllAccounts()',
  );
  const redirect = signoutSource.indexOf('window.location.href = "/login"');
  assert.ok(serverCleanup !== -1 && serverCleanup < redirect);
});

test("force-signout expires every browser authentication cookie", async () => {
  const load = loader({
    "next/server": { NextResponse },
    "@/lib/auth/sessionRevocation": { revokeSessionToken: async () => {} },
    "@/lib/auth/betterAuth": { auth: { api: { signOut: async () => NextResponse.json({ success: true }) } } },
  });
  const names = ["ht_session", "nookies_user", "better-auth.session_token", "__Secure-better-auth.session_token_multi-fixture", "better-auth.session_data.0"];
  const response = await load("src/app/api/auth/force-signout/route.ts").POST(new Request("http://localhost/api/auth/force-signout", {
    method: "POST", headers: { cookie: names.map(name => `${name}=fixture`).join("; ") },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { browserCookiesCleared: true, serverSessionsRevoked: true });
  for (const name of names) {
    assert.equal(response.cookies.get(name)?.value, "");
    assert.equal(response.cookies.get(name)?.maxAge, 0);
  }
});

test("paywall account switcher uses the non-revoking activation path", () => {
  assert.match(purchasePlanSource, /listAccounts\(\)/);
  assert.match(purchasePlanSource, /getActiveAccountId\(\)/);
  assert.match(purchasePlanSource, /account\.id !== activeAccountId/);
  assert.match(purchasePlanSource, /await switchAccount\(account\.sessionToken\)/);
  assert.doesNotMatch(purchasePlanSource, /signOutCurrentAccount/);
});

test("team-less paywall accounts provision once while members stay owner-managed", () => {
  assert.match(purchasePlanSource, /"\/api\/teams\/getAllMinimal"/);
  assert.match(purchasePlanSource, /"\/api\/members\/getAllTeamMembers"/);
  assert.match(purchasePlanSource, /"\/api\/teams\/create"/);
  assert.match(purchasePlanSource, /provisioningRef\.current/);
  assert.match(purchasePlanSource, /teamTitle: `\$\{displayName\}'s Team`/);
  assert.match(purchasePlanSource, /setCurrTeam\(response\.data\)/);
  assert.match(
    purchasePlanSource,
    /Only your team's owner can manage the plan — switch account or ask/,
  );
});
