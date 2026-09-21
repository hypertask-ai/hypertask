// HTPR-4358: a prisma or Stripe failure inside createCustomerIfNull used to be
// swallowed, so /api/stripe/ensure-customer answered 200 with a null customer
// and the user saw only a vague "No billing account" toast. These tests encode
// why that matters: on the money path a failure must be visible as a failure.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

process.env.DATABASE_URL = "postgresql://unused:unused@localhost:5432/unused";
process.env.SESSION_SECRET = "provisioning-test-session-secret";
process.env.STRIPE_SECRET_KEY = "sk_test_unused";
process.env.NEXT_PUBLIC_BASEURL = "https://app.hypertask.ai";

const jiti = require("jiti")(path.join(root, "tests/provisioning-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const loadTs = (rel) => jiti(path.join(root, rel));

const prismaModule = loadTs("src/lib/prisma.ts");
const prisma = prismaModule.default ?? prismaModule;

let teamRow;
let findFirstError;
let updateCalls;
let updateManyError;
let claimCount;
let stripeCustomers;
let stripeCreateError;

prisma.team.findFirst = async () => {
  if (findFirstError) throw findFirstError;
  return teamRow;
};
prisma.team.updateMany = async (args) => {
  updateCalls.push(args);
  if (updateManyError) throw updateManyError;
  return { count: claimCount };
};

const subscription = loadTs("src/lib/subscription.ts");
const { createCustomerIfNull } = subscription;

// The Stripe client is constructed at module load, so patch the instance the
// module actually calls rather than trying to intercept the constructor.
subscription.stripe.customers.create = async (input, options) => {
  stripeCustomers.push({ input, options });
  if (stripeCreateError) throw stripeCreateError;
  return { id: "cus_created" };
};

const serverUser = loadTs("src/lib/auth/serverUser.ts");
serverUser.getServerCookieUser = async () => ({
  id: 6,
  accountId: "account-1",
  email: "owner@example.com",
});

const accessModule = loadTs(
  "src/utils/controllers/teams/hasTeamOwnerOrProjectAdminAccess.ts",
);
const routeModule = loadTs("src/app/api/stripe/ensure-customer/route.ts");

function reset() {
  teamRow = { id: "team-1", stripe_customer_id: null, googleAccountId: "ga-1" };
  findFirstError = undefined;
  updateCalls = [];
  updateManyError = undefined;
  claimCount = 1;
  stripeCustomers = [];
  stripeCreateError = undefined;
}

function ensureCustomerRequest() {
  return new Request("https://app.hypertask.ai/api/stripe/ensure-customer", {
    method: "POST",
    body: JSON.stringify({ teamId: "team-1" }),
  });
}

test("createCustomerIfNull surfaces a database failure instead of returning null", async () => {
  reset();
  findFirstError = new Error("column team.legacy_column does not exist");

  await assert.rejects(
    () => createCustomerIfNull("owner@example.com", "team-1"),
    /legacy_column/,
    "a broken money path must not look like a successful no-op",
  );
});

test("createCustomerIfNull rejects when the team does not exist", async () => {
  reset();
  teamRow = null;

  await assert.rejects(
    () => createCustomerIfNull("owner@example.com", "missing-team"),
    /not found/,
  );
});

test("createCustomerIfNull returns an existing customer without writing", async () => {
  reset();
  teamRow = { id: "team-1", stripe_customer_id: "cus_existing" };

  const result = await createCustomerIfNull("owner@example.com", "team-1");

  assert.equal(result, "cus_existing");
  assert.deepEqual(updateCalls, []);
  assert.deepEqual(
    stripeCustomers,
    [],
    "an existing customer must bypass Stripe creation",
  );
});

test("a Stripe failure propagates instead of resolving to no customer", async () => {
  reset();
  stripeCreateError = new Error("stripe is down");

  await assert.rejects(
    () => createCustomerIfNull("owner@example.com", "team-1"),
    /stripe is down/,
  );
  assert.deepEqual(updateCalls, [], "nothing is claimed when Stripe fails");
});

test("a database claim failure propagates after Stripe customer creation", async () => {
  reset();
  updateManyError = new Error("database write failed");

  await assert.rejects(
    () => createCustomerIfNull("owner@example.com", "team-1"),
    /database write failed/,
  );
  assert.equal(stripeCustomers.length, 1);
  assert.equal(updateCalls.length, 1);
});

test("customer creation keeps its Stripe request stable across team members", async () => {
  reset();

  const first = await createCustomerIfNull("owner@example.com", "team-1");
  const second = await createCustomerIfNull("member@example.com", "team-1");

  assert.equal(first, "cus_created");
  assert.equal(second, "cus_created");
  assert.equal(stripeCustomers.length, 2);
  assert.deepEqual(
    stripeCustomers[0],
    stripeCustomers[1],
    "concurrent team members must send identical idempotent requests",
  );
  assert.deepEqual(stripeCustomers[0].input, { name: "Hypertask team:team-1" });
  assert.equal(
    stripeCustomers[0].options.idempotencyKey,
    "hypertask-team:team-1:stripe-customer",
    "a retry must reuse the same Stripe customer rather than orphan a duplicate",
  );
  assert.equal(
    stripeCustomers[0].options.maxNetworkRetries,
    10,
    "stripe-node must retry a concurrent idempotency-key conflict",
  );
});

test("a lost provisioning race returns the customer that is actually stored", async () => {
  reset();
  claimCount = 0;
  let call = 0;
  const originalFindFirst = prisma.team.findFirst;
  prisma.team.findFirst = async () => {
    call += 1;
    // First read sees no customer; after the race is lost the stored row has
    // the winner's customer.
    return call === 1
      ? { id: "team-1", stripe_customer_id: null }
      : { stripe_customer_id: "cus_winner" };
  };

  try {
    const result = await createCustomerIfNull("owner@example.com", "team-1");
    assert.equal(result, "cus_winner");
    assert.equal(stripeCustomers.length, 1);
    assert.deepEqual(updateCalls, [
      {
        where: { id: "team-1", stripe_customer_id: null },
        data: { stripe_customer_id: "cus_created" },
      },
    ]);
  } finally {
    prisma.team.findFirst = originalFindFirst;
  }
});

test("ensure-customer answers 500, not 200-with-null, when provisioning fails", async () => {
  reset();
  const originalHasAccess = accessModule.default;
  accessModule.default = async () => true;
  const originalFindFirst = prisma.team.findFirst;
  // The route's own team lookup succeeds; provisioning is what fails.
  let call = 0;
  prisma.team.findFirst = async () => {
    call += 1;
    if (call === 1) {
      return {
        id: "team-1",
        googleAccountId: "ga-1",
        stripe_customer_id: null,
        googleAccount: { userId: 6 },
      };
    }
    throw new Error("column team.legacy_column does not exist");
  };

  try {
    const response = await routeModule.POST(ensureCustomerRequest());
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.stripe_customer_id, undefined);
    assert.ok(body.error);
  } finally {
    prisma.team.findFirst = originalFindFirst;
    accessModule.default = originalHasAccess;
  }
});
