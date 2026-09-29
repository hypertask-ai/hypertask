const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const originalSessionSecret = process.env.SESSION_SECRET;
const originalJwtSecret = process.env.JWT_SECRET;
process.env.DATABASE_URL = "postgresql://unused:unused@localhost:5432/unused";
process.env.SESSION_SECRET = "server-user-auth-test-secret";
delete process.env.JWT_SECRET;

function stubModule(filename, exports) {
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

let requestCookies = {};
let trustedUser;
let userLookup;
let team;
let portalCustomerIds = [];

const nextHeaders = require("next/headers");
const originalCookies = nextHeaders.cookies;
nextHeaders.cookies = async () => ({
  get: (name) =>
    requestCookies[name] === undefined
      ? undefined
      : { name, value: requestCookies[name] },
});

stubModule(path.join(root, "src/lib/prisma.ts"), {
  default: {
    user: {
      findUnique: async (args) => {
        userLookup = args;
        return trustedUser;
      },
    },
    team: {
      findUnique: async () => team,
    },
  },
});

stubModule(path.join(root, "src/lib/subscription.ts"), {
  generateCustomerPortalLink: async (customerId) => {
    portalCustomerIds.push(customerId);
    return "https://billing.stripe.test/session";
  },
});

const jiti = require("jiti")(
  path.join(root, "tests/server-user-auth-entry.cjs"),
  {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
    cache: false,
  },
);
const { signSession } = jiti(path.join(root, "src/lib/auth/session.ts"));
const { getServerCookieUser } = jiti(
  path.join(root, "src/lib/auth/serverUser.ts"),
);
const { POST: openBillingPortal } = jiti(
  path.join(root, "src/app/api/stripe/billing-portal/route.ts"),
);

const ATTACKER_ID = 99;

function setSignedRequest(profile) {
  requestCookies = {
    nookies_user: JSON.stringify(profile),
    ht_session: signSession({
      id: ATTACKER_ID,
      email: "attacker@example.test",
    }),
  };
}

function reset() {
  requestCookies = {};
  trustedUser = {
    id: ATTACKER_ID,
    uid: "attacker-firebase-id",
    displayName: "Attacker",
    photoURL: null,
    email: "attacker@example.test",
    joinedAt: new Date("2026-01-01T00:00:00.000Z"),
    UserSettingId: "settings-attacker",
    accountId: "attacker-account",
    stripe_customer_id: "cus_attacker",
    UserSetting: { id: "settings-attacker", userId: ATTACKER_ID },
  };
  userLookup = undefined;
  team = {
    googleAccount: { userId: 42 },
    googleAccountId: "victim-account",
    stripe_customer_id: "cus_victim",
  };
  portalCustomerIds = [];
}

test.after(() => {
  nextHeaders.cookies = originalCookies;
  if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSessionSecret;
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
});

test("forged unsigned profile fields are replaced with trusted user data", async () => {
  reset();
  setSignedRequest({
    id: ATTACKER_ID,
    accountId: "victim-account",
    email: "victim@example.test",
    displayName: "Victim",
  });

  const user = await getServerCookieUser();

  assert.equal(user?.id, ATTACKER_ID);
  assert.equal(user?.accountId, "attacker-account");
  assert.equal(user?.email, "attacker@example.test");
  assert.equal(user?.displayName, "Attacker");
  assert.equal(userLookup?.where?.id, ATTACKER_ID);
});

test("a profile cookie without a matching signed session is rejected", async () => {
  reset();
  requestCookies = {
    nookies_user: JSON.stringify({
      id: ATTACKER_ID,
      accountId: "victim-account",
    }),
  };

  assert.equal(await getServerCookieUser(), null);
  assert.equal(userLookup, undefined);
});

test("a legitimate signed user receives the trusted profile", async () => {
  reset();
  setSignedRequest({
    id: ATTACKER_ID,
    accountId: "attacker-account",
    email: "attacker@example.test",
  });

  assert.deepEqual(await getServerCookieUser(), trustedUser);
});

test("a forged account identifier cannot open another team's billing portal", async () => {
  reset();
  setSignedRequest({
    id: ATTACKER_ID,
    accountId: "victim-account",
    email: "attacker@example.test",
  });

  const response = await openBillingPortal(
    new Request("https://app.hypertask.ai/api/stripe/billing-portal", {
      method: "POST",
      body: JSON.stringify({ teamId: "victim-team" }),
    }),
  );

  assert.equal(response.status, 403);
  assert.deepEqual(portalCustomerIds, []);
});

test("a legitimate team owner can still open their billing portal", async () => {
  reset();
  team.googleAccount.userId = ATTACKER_ID;
  setSignedRequest({
    id: ATTACKER_ID,
    accountId: "attacker-account",
    email: "attacker@example.test",
  });

  const response = await openBillingPortal(
    new Request("https://app.hypertask.ai/api/stripe/billing-portal", {
      method: "POST",
      body: JSON.stringify({ teamId: "attacker-team" }),
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(portalCustomerIds, ["cus_victim"]);
});
