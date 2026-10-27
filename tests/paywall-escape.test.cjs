const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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

test("hard reset clears server cookies even when Better Auth sign-out is unavailable", () => {
  assert.match(signoutSource, /await signOutAllAccounts\(\)/);
  assert.doesNotMatch(signoutSource, /if \(!\(await signOutAllAccounts\(\)\)\)/);
  assert.match(signoutSource, /await axios\.post\("\/api\/auth\/force-signout"\)/);
  assert.match(signoutSource, /window\.location\.href = "\/login"/);

  const serverCleanup = signoutSource.indexOf(
    'await axios.post("/api/auth/force-signout")',
  );
  const redirect = signoutSource.indexOf('window.location.href = "/login"');
  assert.ok(serverCleanup !== -1 && serverCleanup < redirect);
});

test("force-signout expires every browser authentication cookie", () => {
  assert.match(forceSignoutSource, /NextResponse\.json\(\{ ok: true \}\)/);
  assert.match(forceSignoutSource, /response\.cookies\.set\(SESSION_COOKIE/);
  assert.match(forceSignoutSource, /response\.cookies\.set\("nookies_user"/);
  assert.match(forceSignoutSource, /clearBetterAuthSessionCookies\(response\)/);
  assert.equal(forceSignoutSource.match(/maxAge: 0/g)?.length, 2);
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
