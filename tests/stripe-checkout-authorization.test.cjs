const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

process.env.DATABASE_URL = "postgresql://unused:unused@localhost:5432/unused";
process.env.SESSION_SECRET = "checkout-test-session-secret";
process.env.STRIPE_SECRET_KEY = "sk_test_unused";
process.env.NEXT_PUBLIC_BASEURL = "https://app.hypertask.ai";
process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID_BYOK = "price_byok_month";
process.env.NEXT_PUBLIC_STRIPE_YEARLY_PRICE_ID_BYOK = "price_byok_year";
process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID_PRO = "price_pro_month";
process.env.NEXT_PUBLIC_STRIPE_YEARLY_PRICE_ID_PRO = "price_pro_year";
process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID = "price_legacy_trial";

const jiti = require("jiti")(
  path.join(root, "tests/stripe-checkout-entry.cjs"),
  {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  },
);
const loadTs = (rel) => jiti(path.join(root, rel));

const prismaModule = loadTs("src/lib/prisma.ts");
const prisma = prismaModule.default ?? prismaModule;
const stripeModule = loadTs("src/lib/stripe.ts");
const seatModule = loadTs("src/lib/resolveSeatQuantity.ts");
const reservationModule = loadTs(
  "src/utils/controllers/stripe/checkoutReservation.ts",
);

let teamRow;
let listedCustomer;
let subscriptionPages;
let subscriptionListRequests;
let existingSubscriptions;
let openCheckoutSessions;
let createdCheckout;
let createdCheckoutOptions;
let createdCheckoutCount;
let expiredCheckoutIds;
let checkoutSessionsById;
let checkoutSessionsByIdempotencyKey;
let checkoutListingHidden;
let checkoutFailureOnce;
let checkoutAttemptedKeys;
let seatLookup;
let resolvedSeats;
let reservationRecord;
let reservationWriteCount;
let failReservationWriteAt;
let onReservationLockAcquired;
let concurrentReservations;
let reservationInvocationCount;
let lostReservationInvocations;
let reservationTail = Promise.resolve();
let pauseFirstCheckout;
let firstCheckoutStarted;
let releaseFirstCheckout;
let stripeCreateCallCount;

stripeModule.getStripeInstance = () => ({
  subscriptions: {
    list: async (request) => {
      const { customer, starting_after: startingAfter } = request;
      listedCustomer = customer;
      subscriptionListRequests.push(request);
      if (subscriptionPages) {
        const pageIndex = startingAfter
          ? subscriptionPages.findIndex((page) =>
              page.data.some(
                (subscription) => subscription.id === startingAfter,
              ),
            ) + 1
          : 0;
        return subscriptionPages[pageIndex];
      }
      return { data: existingSubscriptions, has_more: false };
    },
  },
  checkout: {
    sessions: {
      list: async () => ({
        data: checkoutListingHidden ? [] : [...checkoutSessionsById.values()],
        has_more: false,
      }),
      retrieve: async (sessionId) => checkoutSessionsById.get(sessionId),
      expire: async (sessionId) => {
        expiredCheckoutIds.push(sessionId);
        const session = checkoutSessionsById.get(sessionId);
        if (session) session.status = "expired";
        openCheckoutSessions = openCheckoutSessions.filter(
          (session) => session.id !== sessionId,
        );
      },
    },
  },
});
stripeModule.createStripeCheckout = async (checkout, options) => {
  stripeCreateCallCount += 1;
  createdCheckout = checkout;
  createdCheckoutOptions = options;
  checkoutAttemptedKeys.push(options?.idempotencyKey);
  if (pauseFirstCheckout && stripeCreateCallCount === 1) {
    firstCheckoutStarted();
    await new Promise((resolve) => {
      releaseFirstCheckout = resolve;
    });
  } else if (pauseFirstCheckout && stripeCreateCallCount === 2) {
    throw Object.assign(new Error("idempotency request still in progress"), {
      statusCode: 409,
      type: "StripeIdempotencyError",
    });
  }
  if (checkoutFailureOnce) {
    const error = checkoutFailureOnce;
    checkoutFailureOnce = undefined;
    throw error;
  }
  const existing = checkoutSessionsByIdempotencyKey.get(
    options?.idempotencyKey,
  );
  if (existing) return existing;

  createdCheckoutCount += 1;
  const session = {
    id: `cs_test_${createdCheckoutCount}`,
    url: `https://checkout.stripe.test/session-${createdCheckoutCount}`,
    success_url: checkout.returnUrl,
    cancel_url: checkout.cancelUrl,
    metadata: checkout.metadata,
    customer: checkout.stripe_customer_id,
    status: "open",
    subscription: null,
  };
  openCheckoutSessions.push(session);
  checkoutSessionsById.set(session.id, session);
  checkoutSessionsByIdempotencyKey.set(options?.idempotencyKey, session);
  return session;
};
seatModule.resolveSeatQuantity = async (teamId, fallback) => {
  seatLookup = { teamId, fallback };
  return resolvedSeats;
};

prisma.team.findUnique = async () => teamRow;
prisma.user.findUnique = async () => ({ uid: "firebase-user" });
prisma.$transaction = async () => {
  throw new Error("Stripe checkout must not use a Prisma transaction");
};
reservationModule.withTeamCheckoutReservation = async (_teamId, run) => {
  const execute = async () => {
    const invocation = ++reservationInvocationCount;
    const assertHeld = () => {
      if (lostReservationInvocations.has(invocation)) {
        throw new reservationModule.CheckoutReservationLockLostError();
      }
    };
    if (onReservationLockAcquired) onReservationLockAcquired();
    return await run({
      assertHeld,
      read: async () => {
        assertHeld();
        return reservationRecord;
      },
      clear: async () => {
        assertHeld();
        reservationRecord = null;
      },
      write: async (attempt) => {
        assertHeld();
        reservationWriteCount += 1;
        if (reservationWriteCount === failReservationWriteAt) {
          throw new Error("simulated local reservation write failure");
        }
        reservationRecord = attempt;
      },
    });
  };
  if (concurrentReservations) return execute();

  const previous = reservationTail;
  let release;
  reservationTail = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await execute();
  } finally {
    release();
  }
};

const { createAuthorizedCheckoutSession } = loadTs(
  "src/utils/controllers/stripe/createAuthorizedCheckoutSession.ts",
);
const checkoutHandlerModule = loadTs(
  "src/pages/api/stripe/session/checkout.ts",
);
const checkoutHandler = checkoutHandlerModule.default ?? checkoutHandlerModule;
const { SESSION_COOKIE, signSession } = loadTs("src/lib/auth/session.ts");

const ownedTeam = (overrides = {}) => ({
  id: "team-owned",
  title: "Owned team",
  totalSeats: 4,
  googleAccountId: "account-owned",
  stripe_customer_id: "cus_owned",
  activeSubscriptionPlanId: null,
  googleAccount: { userId: 6 },
  team_activity: { hasCompletedTrial: false },
  ...overrides,
});

const validBody = (overrides = {}) => ({
  teamId: "team-owned",
  priceId: "price_pro_month",
  mode: "Normal",
  returnUrl:
    "https://app.hypertask.ai/full-plan-confirmation?session_id={CHECKOUT_SESSION_ID}",
  cancelUrl: "https://app.hypertask.ai/pricing?success=0",
  stripe_customer_id: "cus_owned",
  googleAccountId: "account-owned",
  teamTitle: "Client title",
  quantity: 1,
  ...overrides,
});

function reset(overrides = {}) {
  teamRow = ownedTeam(overrides);
  listedCustomer = undefined;
  subscriptionPages = undefined;
  subscriptionListRequests = [];
  existingSubscriptions = [];
  openCheckoutSessions = [];
  createdCheckout = undefined;
  createdCheckoutOptions = undefined;
  createdCheckoutCount = 0;
  expiredCheckoutIds = [];
  checkoutSessionsById = new Map();
  checkoutSessionsByIdempotencyKey = new Map();
  checkoutListingHidden = false;
  checkoutFailureOnce = undefined;
  checkoutAttemptedKeys = [];
  seatLookup = undefined;
  resolvedSeats = 7;
  reservationRecord = null;
  reservationWriteCount = 0;
  failReservationWriteAt = undefined;
  onReservationLockAcquired = undefined;
  concurrentReservations = false;
  reservationInvocationCount = 0;
  lostReservationInvocations = new Set();
  reservationTail = Promise.resolve();
  pauseFirstCheckout = false;
  firstCheckoutStarted = undefined;
  releaseFirstCheckout = undefined;
  stripeCreateCallCount = 0;
}

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() {
      return this;
    },
  };
}

test("checkout requires POST and a signed session before billing work", async () => {
  reset();
  const getResponse = responseRecorder();
  await checkoutHandler({ method: "GET", cookies: {}, body: {} }, getResponse);
  assert.equal(getResponse.statusCode, 405);
  assert.equal(getResponse.headers.Allow, "POST");

  const unsignedResponse = responseRecorder();
  await checkoutHandler(
    { method: "POST", cookies: {}, body: validBody() },
    unsignedResponse,
  );
  assert.equal(unsignedResponse.statusCode, 401);
  assert.equal(unsignedResponse.body.code, "SESSION_REQUIRED");
  assert.equal(listedCustomer, undefined);
  assert.equal(createdCheckout, undefined);
});

test("a signed non-owner cannot create checkout for another team", async () => {
  reset({ googleAccount: { userId: 99 } });
  const response = responseRecorder();
  await checkoutHandler(
    {
      method: "POST",
      cookies: { [SESSION_COOKIE]: signSession({ id: 6 }) },
      body: validBody(),
    },
    response,
  );

  assert.equal(response.statusCode, 403);
  assert.match(response.body.message, /team owner/i);
  assert.equal(listedCustomer, undefined);
  assert.equal(createdCheckout, undefined);
});

test("ownership is revalidated after checkout serialization is acquired", async () => {
  reset();
  onReservationLockAcquired = () => {
    teamRow.googleAccount = { userId: 99 };
  };

  const result = await createAuthorizedCheckoutSession(6, validBody());

  assert.equal(result.status, 403);
  assert.equal(createdCheckoutCount, 0);
  assert.equal(reservationRecord, null);
});

test("checkout rejects client-controlled customer and account mismatches", async () => {
  reset();
  const customerMismatch = await createAuthorizedCheckoutSession(
    6,
    validBody({ stripe_customer_id: "cus_attacker" }),
  );
  assert.equal(customerMismatch.status, 400);
  assert.match(customerMismatch.body.message, /billing account mismatch/i);

  const accountMismatch = await createAuthorizedCheckoutSession(
    6,
    validBody({ googleAccountId: "account-attacker" }),
  );
  assert.equal(accountMismatch.status, 400);
  assert.match(accountMismatch.body.message, /team account mismatch/i);
  assert.equal(listedCustomer, undefined);
  assert.equal(createdCheckout, undefined);
});

test("checkout rejects arbitrary prices and off-site redirect URLs", async () => {
  reset();
  const unsupportedPrice = await createAuthorizedCheckoutSession(
    6,
    validBody({ priceId: "price_attacker" }),
  );
  assert.equal(unsupportedPrice.status, 400);
  assert.match(unsupportedPrice.body.message, /unsupported checkout price/i);

  const externalRedirect = await createAuthorizedCheckoutSession(
    6,
    validBody({ cancelUrl: "https://attacker.test/collect" }),
  );
  assert.equal(externalRedirect.status, 400);
  assert.match(externalRedirect.body.message, /return url/i);
  assert.equal(listedCustomer, undefined);
  assert.equal(createdCheckout, undefined);
});

test("checkout binds trial and normal modes to their intended price sets", async () => {
  reset();
  const paidPriceWithTrial = await createAuthorizedCheckoutSession(
    6,
    validBody({ mode: "Trial", priceId: "price_pro_month" }),
  );
  assert.equal(paidPriceWithTrial.status, 400);
  assert.match(paidPriceWithTrial.body.message, /unsupported checkout price/i);

  const trialPriceWithNormal = await createAuthorizedCheckoutSession(
    6,
    validBody({ mode: "Normal", priceId: "price_legacy_trial" }),
  );
  assert.equal(trialPriceWithNormal.status, 400);
  assert.match(
    trialPriceWithNormal.body.message,
    /unsupported checkout price/i,
  );
  assert.equal(listedCustomer, undefined);
  assert.equal(createdCheckout, undefined);
});

test("a team cannot start another trial after using one", async () => {
  reset({ team_activity: { hasCompletedTrial: true } });
  const result = await createAuthorizedCheckoutSession(
    6,
    validBody({ mode: "Trial", priceId: "price_legacy_trial" }),
  );

  assert.equal(result.status, 409);
  assert.match(result.body.message, /trial already used/i);
  assert.equal(listedCustomer, "cus_owned");
  assert.equal(createdCheckout, undefined);
});

test("a team with an active subscription cannot start a new trial", async () => {
  reset({ activeSubscriptionPlanId: "sub_active" });
  const result = await createAuthorizedCheckoutSession(
    6,
    validBody({ mode: "Trial", priceId: "price_legacy_trial" }),
  );

  assert.equal(result.status, 409);
  assert.equal(listedCustomer, "cus_owned");
  assert.equal(createdCheckout, undefined);
});

test("Stripe live state blocks a trial when the database entitlement is stale", async () => {
  reset();
  existingSubscriptions = [
    {
      id: "sub_paid_elsewhere",
      status: "active",
      trial_start: null,
      trial_end: null,
      items: { data: [{ price: { id: "price_other" } }] },
    },
  ];

  const result = await createAuthorizedCheckoutSession(
    6,
    validBody({ mode: "Trial", priceId: "price_legacy_trial" }),
  );

  assert.equal(result.status, 409);
  assert.equal(createdCheckout, undefined);
});

test("Stripe trial history stays ineligible after conversion and cancellation", async () => {
  reset();
  existingSubscriptions = [
    {
      id: "sub_old_trial",
      status: "canceled",
      trial_start: 1_786_000_000,
      trial_end: 1_787_209_600,
      items: { data: [{ price: { id: "price_pro_month" } }] },
    },
  ];

  const result = await createAuthorizedCheckoutSession(
    6,
    validBody({ mode: "Trial", priceId: "price_legacy_trial" }),
  );
  assert.equal(result.status, 409);
  assert.equal(listedCustomer, "cus_owned");
  assert.equal(createdCheckout, undefined);
});

test("trial eligibility checks every Stripe subscription page", async () => {
  reset();
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    id: `sub_recent_${index}`,
    status: "canceled",
    trial_start: null,
    trial_end: null,
    items: { data: [{ price: { id: "price_old" } }] },
  }));
  subscriptionPages = [
    { data: firstPage, has_more: true },
    {
      data: [
        {
          id: "sub_historical_trial",
          status: "canceled",
          trial_start: 1_786_000_000,
          trial_end: 1_787_209_600,
          items: { data: [{ price: { id: "price_old" } }] },
        },
      ],
      has_more: false,
    },
  ];

  const result = await createAuthorizedCheckoutSession(
    6,
    validBody({ mode: "Trial", priceId: "price_legacy_trial" }),
  );

  assert.equal(result.status, 409);
  assert.equal(subscriptionListRequests.length, 2);
  assert.equal(
    subscriptionListRequests[1].starting_after,
    firstPage[firstPage.length - 1].id,
  );
  assert.equal(createdCheckout, undefined);
});

test("concurrent trial checkout reuses one durable Stripe reservation", async () => {
  reset();
  const body = validBody({ mode: "Trial", priceId: "price_legacy_trial" });

  const [first, second] = await Promise.all([
    createAuthorizedCheckoutSession(6, body),
    createAuthorizedCheckoutSession(6, body),
  ]);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.body.url, second.body.url);
  assert.equal(createdCheckoutCount, 1);
  assert.match(
    createdCheckoutOptions.idempotencyKey,
    /^team-checkout:team-owned:[0-9a-f-]+$/,
  );
  assert.equal(teamRow.team_activity.hasCompletedTrial, false);
});

test("concurrent trial and paid checkout leave only one completable session", async () => {
  reset();
  const [trial, paid] = await Promise.all([
    createAuthorizedCheckoutSession(
      6,
      validBody({ mode: "Trial", priceId: "price_legacy_trial" }),
    ),
    createAuthorizedCheckoutSession(6, validBody()),
  ]);

  assert.equal(trial.status, 200);
  assert.equal(paid.status, 200);
  assert.equal(createdCheckoutCount, 2);
  assert.deepEqual(expiredCheckoutIds, ["cs_test_1"]);
  assert.equal(openCheckoutSessions.length, 1);
  assert.equal(openCheckoutSessions[0].metadata.checkoutMode, "Normal");
});

test("seat increases expire an under-sized checkout reservation", async () => {
  reset();
  const body = validBody({ mode: "Trial", priceId: "price_legacy_trial" });
  const first = await createAuthorizedCheckoutSession(6, body);
  resolvedSeats = 9;
  const second = await createAuthorizedCheckoutSession(6, body);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.notEqual(first.body.url, second.body.url);
  assert.deepEqual(expiredCheckoutIds, ["cs_test_1"]);
  assert.equal(createdCheckoutCount, 2);
  assert.equal(openCheckoutSessions[0].metadata.checkoutQuantity, "9");
});

test("Stripe success followed by a local write failure retries one attempt without duplicates", async () => {
  reset();
  failReservationWriteAt = 3;

  await assert.rejects(
    createAuthorizedCheckoutSession(6, validBody()),
    /reservation write failure/,
  );
  assert.equal(createdCheckoutCount, 1);
  assert.ok(reservationRecord);
  assert.equal(reservationRecord.sessionId, undefined);
  const firstIdempotencyKey = reservationRecord.idempotencyKey;

  failReservationWriteAt = undefined;
  const retry = await createAuthorizedCheckoutSession(6, validBody());

  assert.equal(retry.status, 200);
  assert.equal(createdCheckoutCount, 1);
  assert.equal(reservationRecord.sessionId, "cs_test_1");
  assert.equal(reservationRecord.idempotencyKey, firstIdempotencyKey);
  assert.equal(openCheckoutSessions.length, 1);
});

test("a saved reservation survives an eventually consistent session listing", async () => {
  reset();
  const first = await createAuthorizedCheckoutSession(6, validBody());
  checkoutListingHidden = true;

  const retry = await createAuthorizedCheckoutSession(6, validBody());

  assert.equal(retry.status, 200);
  assert.equal(retry.body.url, first.body.url);
  assert.equal(createdCheckoutCount, 1);
  assert.equal(reservationRecord.sessionId, "cs_test_1");
});

test("a definitive Stripe rejection clears the pending attempt immediately", async () => {
  reset();
  checkoutFailureOnce = Object.assign(new Error("invalid checkout"), {
    statusCode: 400,
    type: "StripeInvalidRequestError",
  });

  await assert.rejects(
    createAuthorizedCheckoutSession(6, validBody()),
    /invalid checkout/,
  );
  const rejectedKey = checkoutAttemptedKeys[0];
  assert.equal(reservationRecord, null);

  const retry = await createAuthorizedCheckoutSession(6, validBody());
  assert.equal(retry.status, 200);
  assert.notEqual(checkoutAttemptedKeys[1], rejectedKey);
});

test("an ambiguous attempt settles under its original key before changing selection", async () => {
  reset();
  checkoutFailureOnce = Object.assign(new Error("connection reset"), {
    type: "StripeConnectionError",
  });
  const ambiguous = await createAuthorizedCheckoutSession(6, validBody());
  const pendingKey = reservationRecord.idempotencyKey;

  const changed = await createAuthorizedCheckoutSession(
    6,
    validBody({ priceId: "price_byok_month" }),
  );

  assert.equal(ambiguous.status, 409);
  assert.equal(changed.status, 200);
  assert.equal(reservationRecord.desired.priceId, "price_byok_month");
  assert.notEqual(reservationRecord.idempotencyKey, pendingKey);
  assert.deepEqual(checkoutAttemptedKeys, [
    pendingKey,
    pendingKey,
    reservationRecord.idempotencyKey,
  ]);
  assert.deepEqual(expiredCheckoutIds, ["cs_test_1"]);
  assert.equal(openCheckoutSessions.length, 1);
  assert.equal(openCheckoutSessions[0].metadata.priceId, "price_byok_month");
});

test("lease loss cannot let a changed selection replace an in-flight key", async () => {
  reset();
  concurrentReservations = true;
  pauseFirstCheckout = true;
  const firstStarted = new Promise((resolve) => {
    firstCheckoutStarted = resolve;
  });

  const first = createAuthorizedCheckoutSession(6, validBody());
  await firstStarted;
  const authoritativeKey = reservationRecord.idempotencyKey;
  assert.equal(reservationRecord.state, "in_flight");
  lostReservationInvocations.add(1);

  const changed = await createAuthorizedCheckoutSession(
    6,
    validBody({ priceId: "price_byok_month" }),
  );

  assert.equal(changed.status, 409);
  assert.match(changed.body.message, /retry shortly/i);
  assert.deepEqual(checkoutAttemptedKeys, [authoritativeKey, authoritativeKey]);
  assert.equal(reservationRecord.idempotencyKey, authoritativeKey);
  assert.equal(reservationRecord.state, "in_flight");

  releaseFirstCheckout();
  await assert.rejects(
    first,
    (error) => error.name === "CheckoutReservationLockLostError",
  );
  assert.equal(createdCheckoutCount, 1);
  assert.equal(openCheckoutSessions.length, 1);
  assert.equal(new Set(checkoutAttemptedKeys).size, 1);
});

test("a changed selection safely replaces an abandoned prepared attempt", async () => {
  reset();
  const abandoned = reservationModule.createCheckoutAttempt({
    cancelUrl: validBody().cancelUrl,
    checkoutMode: "Normal",
    customerId: "cus_owned",
    googleAccountId: "account-owned",
    priceId: "price_pro_month",
    quantity: 7,
    returnUrl: validBody().returnUrl,
    teamId: "team-owned",
  });
  reservationRecord = abandoned;

  const changed = await createAuthorizedCheckoutSession(
    6,
    validBody({ priceId: "price_byok_month" }),
  );

  assert.equal(changed.status, 200);
  assert.equal(createdCheckoutCount, 1);
  assert.equal(checkoutAttemptedKeys.length, 1);
  assert.notEqual(checkoutAttemptedKeys[0], abandoned.idempotencyKey);
  assert.equal(reservationRecord.desired.priceId, "price_byok_month");
  assert.equal(reservationRecord.state, "settled");
});

test("an interrupted attempt is versioned after its Stripe session expires", async () => {
  reset();
  failReservationWriteAt = 3;
  await assert.rejects(
    createAuthorizedCheckoutSession(6, validBody()),
    /reservation write failure/,
  );
  const interruptedAttemptId = reservationRecord.attemptId;
  const interruptedKey = reservationRecord.idempotencyKey;
  const expired = checkoutSessionsById.get("cs_test_1");
  expired.status = "expired";
  openCheckoutSessions = [];

  failReservationWriteAt = undefined;
  const retry = await createAuthorizedCheckoutSession(6, validBody());

  assert.equal(retry.status, 200);
  assert.equal(createdCheckoutCount, 2);
  assert.notEqual(reservationRecord.attemptId, interruptedAttemptId);
  assert.notEqual(reservationRecord.idempotencyKey, interruptedKey);
});

test("an expired checkout starts a new attempt and never reuses its key", async () => {
  reset();
  const first = await createAuthorizedCheckoutSession(6, validBody());
  const firstAttemptId = reservationRecord.attemptId;
  const firstKey = reservationRecord.idempotencyKey;
  const firstSession = checkoutSessionsById.get("cs_test_1");
  firstSession.status = "expired";
  openCheckoutSessions = [];

  const second = await createAuthorizedCheckoutSession(6, validBody());

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(createdCheckoutCount, 2);
  assert.notEqual(reservationRecord.attemptId, firstAttemptId);
  assert.notEqual(reservationRecord.idempotencyKey, firstKey);
  assert.notEqual(first.body.url, second.body.url);
});

test("an orphan checkout with stale redirects is replaced instead of adopted", async () => {
  reset();
  const first = await createAuthorizedCheckoutSession(6, validBody());
  reservationRecord = null;
  const changedReturnUrl =
    "https://app.hypertask.ai/full-plan-confirmation?source=settings";

  const second = await createAuthorizedCheckoutSession(
    6,
    validBody({ returnUrl: changedReturnUrl }),
  );

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(createdCheckoutCount, 2);
  assert.deepEqual(expiredCheckoutIds, ["cs_test_1"]);
  assert.equal(createdCheckout.returnUrl, changedReturnUrl);
  assert.notEqual(first.body.url, second.body.url);
});

test("a completed checkout is reconciled without reusing or replacing its attempt", async () => {
  reset();
  await createAuthorizedCheckoutSession(6, validBody());
  const completed = checkoutSessionsById.get("cs_test_1");
  completed.status = "complete";
  completed.subscription = "sub_completed";
  openCheckoutSessions = [];

  const retry = await createAuthorizedCheckoutSession(6, validBody());

  assert.equal(retry.status, 200);
  assert.equal(retry.body.alreadySubscribed, true);
  assert.equal(retry.body.subscriptionId, "sub_completed");
  assert.equal(createdCheckoutCount, 1);
  assert.equal(reservationRecord.sessionId, "cs_test_1");
});

test("a completed checkout survives changed redirects and stale Stripe listings", async () => {
  reset();
  const first = await createAuthorizedCheckoutSession(6, validBody());
  const firstAttemptId = reservationRecord.attemptId;
  const completed = checkoutSessionsById.get("cs_test_1");
  completed.status = "complete";
  completed.subscription = "sub_completed";
  openCheckoutSessions = [];
  checkoutListingHidden = true;

  const retry = await createAuthorizedCheckoutSession(
    6,
    validBody({
      returnUrl:
        "https://app.hypertask.ai/full-plan-confirmation?flow=retry&session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: "https://app.hypertask.ai/pricing?success=0&flow=retry",
    }),
  );

  assert.equal(first.status, 200);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.alreadySubscribed, true);
  assert.equal(retry.body.subscriptionId, "sub_completed");
  assert.equal(createdCheckoutCount, 1);
  assert.equal(reservationRecord.attemptId, firstAttemptId);
  assert.equal(reservationRecord.sessionId, "cs_test_1");
});

test("a completed reservation never overrides a new plan selection", async () => {
  reset();
  await createAuthorizedCheckoutSession(6, validBody());
  const firstKey = reservationRecord.idempotencyKey;
  const completed = checkoutSessionsById.get("cs_test_1");
  completed.status = "complete";
  completed.subscription = "sub_completed";
  openCheckoutSessions = [];

  const changed = await createAuthorizedCheckoutSession(
    6,
    validBody({ priceId: "price_byok_month" }),
  );

  assert.equal(changed.status, 200);
  assert.equal(changed.body.alreadySubscribed, undefined);
  assert.equal(createdCheckoutCount, 2);
  assert.equal(reservationRecord.desired.priceId, "price_byok_month");
  assert.notEqual(reservationRecord.idempotencyKey, firstKey);
});

test("a rejected trial preserves an unrelated open paid checkout", async () => {
  reset();
  const paid = await createAuthorizedCheckoutSession(6, validBody());
  teamRow.activeSubscriptionPlanId = "sub_active";

  const rejectedTrial = await createAuthorizedCheckoutSession(
    6,
    validBody({ mode: "Trial", priceId: "price_legacy_trial" }),
  );

  assert.equal(paid.status, 200);
  assert.equal(rejectedTrial.status, 409);
  assert.deepEqual(expiredCheckoutIds, []);
  assert.equal(openCheckoutSessions.length, 1);
  assert.equal(openCheckoutSessions[0].metadata.checkoutMode, "Normal");
  assert.equal(reservationRecord.desired.checkoutMode, "Normal");
  assert.equal(reservationRecord.sessionId, "cs_test_1");
});

test("owner checkout uses only server-derived billing identity and seat count", async () => {
  reset();
  const result = await createAuthorizedCheckoutSession(
    6,
    validBody({
      stripe_customer_id: undefined,
      googleAccountId: undefined,
      teamTitle: "Spoofed title",
      quantity: 1,
    }),
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.url, "https://checkout.stripe.test/session-1");
  assert.equal(listedCustomer, "cus_owned");
  assert.deepEqual(seatLookup, { teamId: "team-owned", fallback: 4 });
  assert.equal(createdCheckout.stripe_customer_id, "cus_owned");
  assert.equal(createdCheckout.googleAccountId, "account-owned");
  assert.equal(createdCheckout.teamTitle, "Owned team");
  assert.equal(createdCheckout.quantity, 7);
  assert.equal(createdCheckout.metadata.teamId, "team-owned");
});

test("duplicate subscription detection uses the owned team's customer", async () => {
  reset();
  existingSubscriptions = [
    {
      id: "sub_existing",
      status: "active",
      items: { data: [{ price: { id: "price_pro_month" } }] },
    },
  ];

  const result = await createAuthorizedCheckoutSession(6, validBody());
  assert.equal(result.status, 200);
  assert.equal(result.body.alreadySubscribed, true);
  assert.equal(result.body.subscriptionId, "sub_existing");
  assert.equal(listedCustomer, "cus_owned");
  assert.equal(createdCheckout, undefined);
});

test("a duplicate paid retry preserves a different open trial checkout", async () => {
  reset();
  const trial = await createAuthorizedCheckoutSession(
    6,
    validBody({ mode: "Trial", priceId: "price_legacy_trial" }),
  );
  const trialReservation = reservationRecord;
  existingSubscriptions = [
    {
      id: "sub_existing",
      status: "active",
      items: { data: [{ price: { id: "price_pro_month" } }] },
    },
  ];

  const duplicate = await createAuthorizedCheckoutSession(6, validBody());

  assert.equal(trial.status, 200);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.alreadySubscribed, true);
  assert.deepEqual(expiredCheckoutIds, []);
  assert.equal(openCheckoutSessions.length, 1);
  assert.equal(openCheckoutSessions[0].metadata.checkoutMode, "Trial");
  assert.equal(reservationRecord, trialReservation);
});

test("checkout authorization does not expose owner identity through getTeamById", () => {
  const plansSource = fs.readFileSync(
    path.join(root, "src/components/Modals/Settings/PlansSection.tsx"),
    "utf8",
  );
  const trialSource = fs.readFileSync(
    path.join(root, "src/components/Modals/TrialPlan/TrialPlanComponents.tsx"),
    "utf8",
  );
  const serverActionsSource = fs.readFileSync(
    path.join(root, "src/lib/serverActions/index.ts"),
    "utf8",
  );

  assert.match(plansSource, /disabled=\{[\s\S]*?!isOwner/);
  assert.match(plansSource, /"Owner only"/);
  assert.match(trialSource, /let cancelled = false/);
  assert.match(trialSource, /if \(cancelled\) return/);
  assert.match(trialSource, /cancelled = true/);
  assert.doesNotMatch(trialSource, /res\.googleAccount\.userId/);
  const getTeamByIdSource = serverActionsSource.slice(
    serverActionsSource.indexOf("export const getTeamById"),
    serverActionsSource.indexOf("export const getTeamInviteUrl"),
  );
  assert.doesNotMatch(getTeamByIdSource, /googleAccount|userId/);
});

test("checkout webhooks never reset completed trial history to false", () => {
  for (const relativePath of [
    "src/utils/controllers/stripe/webhook/onCheckoutSuccess.ts",
    "src/utils/controllers/stripe/webhook/onSubscriptionUpdated.ts",
  ]) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    assert.doesNotMatch(source, /hasCompletedTrial:\s*false/);
    assert.doesNotMatch(
      source,
      /hasCompletedTrial:\s*subscription\.status\s*===/,
    );
  }
});
