const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule: load } = require("./helpers/loadModule.cjs");

const { harness } = require("./helpers/start-plan-checkout.cjs");
const flag = load("src/lib/flags/definitions/htpr-7551-start-plan-checkout.ts");
const boardUrl = "https://app.hypertask.ai/project?id=7&view=default#board";
const startBody = (extra = {}) => ({ intent: "signup-straight-to-board", teamId: "team-owned", boardUrl, ...extra });
const legacyBody = (extra = {}) => ({
  teamId: "team-owned", mode: "Trial", priceId: "price_legacy_trial",
  returnUrl: "https://app.hypertask.ai/trial-page-confirmation",
  cancelUrl: "https://app.hypertask.ai", ...extra,
});
const subscription = (status, extra = {}) => ({
  id: `sub_${status}`, status, trial_start: null, trial_end: null,
  items: { data: [{ price: { id: "price_pro_month" } }] }, ...extra,
});


for (const enabled of [true, false]) {
  test(`legacy trial remains allowed with frozen ${enabled ? 7 : 14} days and its legacy price (flag ${enabled})`, async () => {
    const h = harness(); h.enabled = enabled;
    assert.equal((await h.checkout(legacyBody({ trialDays: 99, quantity: 99 }))).status, 200);
    const payload = h.calls[0].payload;
    assert.equal(payload.subscription_data.trial_period_days, enabled ? 7 : 14);
    assert.equal(payload.line_items[0].price, "price_legacy_trial");
    assert.equal(payload.line_items[0].quantity, 3);
    assert.deepEqual(payload.line_items[0].adjustable_quantity, { enabled: true, minimum: 3 });
    assert.equal(h.record.desired.trialDays, enabled ? 7 : undefined);
    assert.equal(payload.metadata.trialDays, enabled ? "7" : undefined);
  });
}

test("new intent refuses flag OFF; eligible Free owner is still allowed with server Pro price, exact seats and safe board returns", async () => {
  const refused = harness(); refused.enabled = false;
  assert.equal((await refused.checkout()).status, 403);
  assert.equal(refused.calls.length, 0);
  assert.deepEqual(refused.stripeCalls, []);
  assert.equal(refused.locks, 0);
  assert.equal(refused.record, null);
  const h = harness();
  const preview = await h.checkout(startBody({ action: "preview" }));
  assert.deepEqual(preview.body, { canStartPlan: true, trialDays: 7 });
  assert.equal(h.record, null); assert.equal(h.calls.length, 0);
  assert.equal((await h.checkout()).status, 200);
  const payload = h.calls[0].payload;
  assert.equal(payload.customer, "cus_owned");
  assert.deepEqual(payload.line_items, [{ price: "price_pro_month", quantity: 3 }]);
  assert.equal(payload.subscription_data.trial_period_days, 7);
  assert.equal(payload.success_url, boardUrl);
  assert.equal(payload.cancel_url, boardUrl);
  assert.equal(payload.payment_method_collection, "always");
  assert.equal(payload.metadata.trialDays, "7");
  assert.equal(payload.metadata.checkoutIntent, "signup-straight-to-board");
  assert.equal(payload.customer_email, undefined);
  assert.equal(h.writes, 0);
});

test("member is refused, owner is still allowed and ownership is rechecked under the lock", async () => {
  const h = harness();
  assert.equal((await h.checkout(startBody(), 99)).status, 403);
  assert.equal(h.calls.length, 0);
  assert.deepEqual(h.flagReads, []);
  assert.equal(h.attemptReads, 0); assert.equal(h.locks, 0);
  assert.equal((await h.checkout()).status, 200);
  assert.deepEqual(h.flagReads, [6]);
  const off = harness(); off.enabled = false;
  assert.equal((await off.checkout(startBody(), 99)).body.message, "Only the team owner can update billing");
  assert.deepEqual(off.flagReads, []); assert.equal(off.attemptReads, 0); assert.equal(off.locks, 0);
  assert.equal((await off.checkout(legacyBody())).status, 200);
  const changed = harness(); changed.onLock = () => { changed.team.googleAccount.userId = 99; };
  assert.equal((await changed.checkout()).status, 403);
  assert.equal(changed.calls.length, 0);
});

for (const rollout of [false, true]) {
  for (const identity of rollout ? ["owner", "account", "customer", "transfer"] : ["account", "customer", "transfer"]) {
    test(`OFF refuses recent ${identity} changes and any customer change on ${rollout ? "rollout" : "legacy"} attempts; safe identity cleanup remains allowed`, async () => {
      for (const hours of [1, 24, 25]) {
        for (const state of ["in_flight", "prepared", "settled"]) {
          for (const savedSessionId of [false, true]) {
            const h = harness(); h.enabled = rollout;
            await h.checkout(rollout ? startBody() : legacyBody());
            const key = h.record.idempotencyKey;
            h.record.state = state;
            h.record.createdAt = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
            h.record.submittedAt = h.record.createdAt;
            if (!savedSessionId) delete h.record.sessionId;
            h.enabled = false;
            if (identity === "owner" || identity === "transfer") h.team.googleAccount.userId = 99;
            if (identity === "account" || identity === "transfer") h.team.googleAccountId = "account-new";
            if (identity === "customer") h.team.stripe_customer_id = "cus_new";
            h.stripeCalls = [];
            const result = await h.checkout(legacyBody(), h.team.googleAccount.userId);
            if (identity === "customer" || (state === "in_flight" && hours < 24)) {
              assert.equal(result.status, identity !== "customer" && rollout && (identity === "owner" || identity === "transfer") ? 403 : 409);
              assert.equal(h.record.idempotencyKey, key);
              assert.equal(h.calls.length, 1);
              assert.deepEqual(h.stripeCalls, []);
              assert.deepEqual(h.expired, []);
              if (identity === "customer") {
                h.team.stripe_customer_id = "cus_owned";
                assert.equal((await h.checkout(rollout ? startBody() : legacyBody())).status, 200);
                assert.equal(h.record.idempotencyKey, key);
                assert.equal(h.calls.length, 1);
              }
            } else {
              assert.equal(result.status, 200);
              assert.notEqual(h.record.idempotencyKey, key);
              assert.deepEqual(h.expired, ["cs_1"]);
              assert.equal(h.calls.length, 2);
              assert.equal(h.calls[1].payload.customer, h.team.stripe_customer_id);
              assert.equal(h.calls[1].payload.metadata.googleAccountId, h.team.googleAccountId);
              assert.equal(h.calls[1].payload.subscription_data.trial_period_days, 14);
            }
          }
        }
      }
    });
  }
}

for (const identity of ["owner", "account"]) {
  for (const state of ["in_flight", "prepared", "settled"]) {
    for (const savedSessionId of [false, true]) {
      test(`${identity} cleanup retains a completed ${state} checkout with saved id=${savedSessionId}; cancellation still permits a new purchase`, async () => {
        const h = harness(); h.team.team_activity.hasCompletedTrial = true;
        await h.checkout();
        const key = h.record.idempotencyKey;
        h.record.state = state;
        h.record.createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
        h.record.submittedAt = h.record.createdAt;
        if (!savedSessionId) delete h.record.sessionId;
        const completed = h.sessions.get("cs_1");
        completed.status = "complete"; completed.subscription = "sub_started";
        h.hidden = savedSessionId; h.enabled = false;
        if (identity === "owner") h.team.googleAccount.userId = 99;
        else h.team.googleAccountId = "account-new";
        const normal = legacyBody({ mode: "Normal", priceId: "price_pro_year" });
        const refused = await h.checkout(normal, h.team.googleAccount.userId);
        assert.equal(refused.status, 409); assert.equal(refused.body.finishing, true);
        assert.equal(h.record.idempotencyKey, key); assert.equal(h.record.sessionId, "cs_1");
        assert.equal(h.record.state, "settled"); assert.equal(h.calls.length, 1);
        h.hidden = true;
        for (const subscriptions of [[], [subscription("canceled", { id: "sub_unrelated" })]]) {
          h.subscriptions = subscriptions;
          const retry = await h.checkout(normal, h.team.googleAccount.userId);
          assert.equal(retry.status, 409); assert.equal(retry.body.finishing, true);
          assert.equal(h.record.idempotencyKey, key); assert.equal(h.record.sessionId, "cs_1");
          assert.equal(h.calls.length, 1);
        }
        h.subscriptions = [subscription("active", { id: "sub_started" })];
        assert.equal((await h.checkout(normal, h.team.googleAccount.userId)).status, 409);
        assert.equal(h.record.idempotencyKey, key); assert.equal(h.calls.length, 1);
        assert.deepEqual(h.expired, []);
        h.subscriptions = [subscription("canceled", { id: "sub_started" })];
        assert.equal((await h.checkout(normal, h.team.googleAccount.userId)).status, 200);
        assert.notEqual(h.record.idempotencyKey, key);
        assert.equal(h.calls.length, 2);
        assert.equal(h.calls[1].payload.line_items[0].price, "price_pro_year");
      });
    }
  }
}

test("OFF rechecks the attempt under the lock after preflight; a vanished attempt refuses without Stripe", async () => {
  const h = harness(); await h.checkout(); h.enabled = false;
  h.stripeCalls = [];
  h.onLock = () => { h.record = null; };
  assert.equal((await h.checkout()).status, 403);
  assert.deepEqual(h.stripeCalls, []);
  assert.equal(h.calls.length, 1);
  h.enabled = true; h.onLock = null;
  assert.equal((await h.checkout()).status, 200);
  assert.equal(h.calls.length, 1);
});

test("new intent rejects every client billing term and arbitrary return destination; ordinary owner request remains allowed", async () => {
  const h = harness();
  for (const extra of [{ priceId: "price_legacy_trial" }, { trialDays: 99 }, { quantity: 999 },
    { stripe_customer_id: "cus_spoof" }, { googleAccountId: "spoof" }, { mode: "Normal" },
    { returnUrl: boardUrl }, { cancelUrl: boardUrl }, { intent: "forged" }]) {
    assert.equal((await h.checkout(startBody(extra))).status, 400, JSON.stringify(extra));
  }
  for (const bad of ["https://evil.test/project?id=7", "https://app.hypertask.ai/pricing?id=7", "https://app.hypertask.ai/project?id=7&id=8"]) {
    assert.equal((await h.checkout(startBody({ boardUrl: bad }))).status, 400);
  }
  assert.equal((await h.checkout(startBody({ boardUrl: "https://app.hypertask.ai/project?id=8" }))).status, 404);
  assert.equal(h.calls.length, 0);
  assert.equal((await h.checkout()).status, 200);
});

test("comped, internally comped and paid teams are refused without writes; Free team is still allowed", async () => {
  for (const extra of [
    { compedUntil: "2099-01-01", compedPlan: "Pro" },
    { compedUntil: "2099-01-01", compedPlan: "BYOK" },
    { id: "08f79efd-770e-4e32-9728-65e6d29ec893" },
    { activeSubscriptionPlanId: "sub_active", subscriptionPlan: [{ subscriptionId: "sub_active", subscriptionStatus: "active", priceId: "price_pro_month" }] },
  ]) {
    const h = harness(); Object.assign(h.team, extra);
    assert.equal((await h.checkout(startBody({ teamId: h.team.id }))).status, 409);
    assert.equal(h.calls.length, 0); assert.equal(h.writes, 0);
  }
  assert.equal((await harness().checkout()).status, 200);
});

test("price contract fails closed for wrong product, amount, currency, interval, activity or quantity transformation", async () => {
  for (const extra of [{ product: "prod_other" }, { unit_amount: 1900 }, { currency: "eur" }, { active: false },
    { type: "one_time" }, { recurring: { interval: "year", interval_count: 1, usage_type: "licensed" } },
    { recurring: { interval: "month", interval_count: 2, usage_type: "licensed" } },
    { recurring: { interval: "month", interval_count: 1, usage_type: "metered" } },
    { billing_scheme: "tiered" }, { transform_quantity: { divide_by: 2, round: "up" } }]) {
    const h = harness(); Object.assign(h.price, extra);
    assert.equal((await h.checkout(startBody({ action: "preview" }))).status, 503);
    assert.equal((await h.checkout()).status, 503);
    assert.equal(h.calls.length, 0);
  }
  const unavailable = harness(); unavailable.priceFailure = true;
  assert.equal((await unavailable.checkout()).status, 503);
  assert.equal(unavailable.calls.length, 0);
  const old = process.env.STRIPE_PRO_PRODUCT_ID;
  try {
    delete process.env.STRIPE_PRO_PRODUCT_ID;
    assert.equal((await harness().checkout()).status, 503);
  } finally { process.env.STRIPE_PRO_PRODUCT_ID = old; }
  assert.equal((await harness().checkout()).status, 200);
});

test("past trials get normal monthly checkout and no free-trial capability claim; legacy repeat trial stays refused", async () => {
  for (const databaseHistory of [true, false]) {
    const h = harness();
    if (databaseHistory) h.team.team_activity.hasCompletedTrial = true;
    else h.subscriptions = [subscription("canceled", { trial_start: 123, trial_end: 456 })];
    const preview = await h.checkout(startBody({ action: "preview" }));
    assert.equal(preview.body.trialDays, 0);
    assert.equal(h.calls.length, 0);
    assert.equal((await h.checkout(legacyBody())).status, 409);
    assert.equal((await h.checkout()).status, 200);
    assert.equal(h.calls[0].payload.subscription_data, undefined);
    assert.equal(h.calls[0].payload.line_items[0].price, "price_pro_month");
  }
});

test("all nonterminal customer subscriptions refuse new intent; terminal subscriptions and unrelated legacy Normal policy remain allowed", async () => {
  for (const status of ["active", "trialing", "past_due", "unpaid", "incomplete", "paused"]) {
    const h = harness(); h.subscriptions = [subscription(status)];
    assert.equal((await h.checkout()).status, 409, status);
    assert.equal(h.calls.length, 0);
  }
  for (const status of ["canceled", "incomplete_expired"]) {
    const h = harness(); h.subscriptions = [subscription(status)];
    assert.equal((await h.checkout()).status, 200);
  }
  const legacy = harness(); legacy.subscriptions = [subscription("paused")];
  assert.equal((await legacy.checkout(legacyBody({ mode: "Normal", priceId: "price_pro_month" }))).status, 200);
});

test("nonterminal and past-trial checks paginate Stripe subscriptions", async () => {
  const h = harness();
  h.subscriptionPages = [
    { data: [subscription("canceled", { id: "sub_page_one" })], has_more: true },
    { data: [subscription("paused")], has_more: false },
  ];
  assert.equal((await h.checkout()).status, 409);
  assert.equal(h.subscriptionRequests[1].starting_after, "sub_page_one");
  const trial = harness(); trial.subscriptionPages = [
    h.subscriptionPages[0], { data: [subscription("canceled", { trial_start: 1 })], has_more: false },
  ];
  assert.equal((await trial.checkout()).status, 200);
  assert.equal(trial.calls[0].payload.subscription_data, undefined);
});

test("double clicks/two tabs reuse one session and old/new tabs serialize and expire the incompatible 14-day offer", async () => {
  const h = harness();
  const [a, b] = await Promise.all([h.checkout(), h.checkout()]);
  assert.equal(a.body.url, b.body.url); assert.equal(h.calls.length, 1);
  const mixed = harness(); mixed.enabled = false;
  await mixed.checkout(legacyBody());
  mixed.enabled = true;
  assert.equal((await mixed.checkout()).status, 200);
  assert.deepEqual(mixed.expired, ["cs_1"]);
  assert.equal(mixed.calls[0].payload.subscription_data.trial_period_days, 14);
  assert.equal(mixed.calls[1].payload.subscription_data.trial_period_days, 7);
  assert.notEqual(mixed.calls[0].key, mixed.calls[1].key);
});

test("compatible orphans are reused, changed trial offers need recovery, and stale redirects expire under the same lock", async () => {
  const h = harness(); const original = await h.checkout(); h.record = null;
  assert.equal((await h.checkout()).body.url, original.body.url);
  assert.equal(h.calls.length, 1);
  h.record = null; h.sessions.get("cs_1").metadata.trialDays = "14";
  assert.equal((await h.checkout()).status, 409);
  assert.deepEqual(h.expired, []);
  assert.equal(h.calls.length, 1);
  h.sessions.get("cs_1").metadata.trialDays = "7";
  h.sessions.get("cs_1").success_url = "https://app.hypertask.ai/project?id=7&view=old";
  assert.equal((await h.checkout()).status, 200);
  assert.deepEqual(h.expired, ["cs_1"]);
});

for (const retryLegacy of [false, true]) {
  test(`lost-response seven-day checkout reconciles identical payload/key after OFF (${retryLegacy ? "legacy" : "header"} retry)`, async () => {
    const h = harness(); h.timeoutAfterCreate = true; h.hidden = true;
    assert.equal((await h.checkout()).status, 409);
    const pending = structuredClone(h.record); h.enabled = false; h.seats = 9;
    const retry = await h.checkout(retryLegacy ? legacyBody() : startBody());
    assert.equal(retry.status, retryLegacy ? 409 : 200);
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[0].key, h.calls[1].key);
    assert.deepEqual(h.calls[0].payload, h.calls[1].payload);
    assert.equal(h.record.attemptId, pending.attemptId);
    assert.deepEqual(h.expired, []);
    assert.equal(h.sessions.size, 1);
  });
}

for (const legacyTimestamp of [false, true]) {
  test(`OFF retains recently submitted old preparations and clears old submissions (legacy timestamp=${legacyTimestamp})`, async () => {
    const h = harness();
    const desired = { teamId: "team-owned", customerId: "cus_owned", googleAccountId: "account-owned",
      ownerUserId: 6, quantity: 3, priceId: "price_pro_month", checkoutMode: "Trial", trialDays: 7,
      checkoutIntent: "signup-straight-to-board", returnUrl: boardUrl, cancelUrl: boardUrl };
    h.record = h.reservations.createCheckoutAttempt(desired);
    h.record.createdAt = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
    const key = h.record.idempotencyKey;
    h.rejectOnce = new Error("ambiguous response");
    assert.equal((await h.checkout()).status, 409);
    const submittedAt = h.record.submittedAt;
    assert.ok(Date.parse(submittedAt) > Date.now() - 60_000);
    assert.equal(h.reservationWrites.find((attempt) => attempt.state === "in_flight").submittedAt, submittedAt);
    h.enabled = false; h.rejectOnce = new Error("still ambiguous");
    assert.equal((await h.checkout(legacyBody())).status, 409);
    assert.equal(h.record.idempotencyKey, key); assert.equal(h.record.submittedAt, submittedAt);
    assert.deepEqual(h.calls.map((call) => call.key), [key, key]);
    h.record.submittedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    if (legacyTimestamp) delete h.record.submittedAt;
    assert.equal((await h.checkout()).status, 403);
    assert.equal(h.record, null); assert.equal(h.calls.length, 2);
    assert.equal((await h.checkout(legacyBody())).status, 200);
    assert.notEqual(h.record.idempotencyKey, key);
    assert.equal(h.calls.at(-1).payload.subscription_data.trial_period_days, 14);
  });
}

for (const identity of ["owner", "account"]) {
  test(`OFF refuses ${identity} transfer for recently submitted old preparation; old submission cleanup still allows legacy checkout`, async () => {
    const h = harness(); h.rejectOnce = new Error("ambiguous response");
    assert.equal((await h.checkout()).status, 409);
    const key = h.record.idempotencyKey;
    h.record.createdAt = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
    h.enabled = false;
    if (identity === "owner") h.team.googleAccount.userId = 99;
    else h.team.googleAccountId = "account-new";
    h.stripeCalls = [];
    assert.equal((await h.checkout(legacyBody(), h.team.googleAccount.userId)).status, identity === "owner" ? 403 : 409);
    assert.equal(h.record.idempotencyKey, key); assert.equal(h.calls.length, 1);
    assert.deepEqual(h.stripeCalls, []);
    h.record.submittedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    assert.equal((await h.checkout(legacyBody(), h.team.googleAccount.userId)).status, 200);
    assert.notEqual(h.record.idempotencyKey, key);
    assert.equal(h.calls.at(-1).payload.subscription_data.trial_period_days, 14);
  });
}

for (const hours of [24, 25]) {
  for (const pastTrial of [false, true]) {
    test(`OFF clears a ${hours}h-old ${pastTrial ? "Normal" : "Trial"} rollout attempt without replay; fresh legacy checkout remains allowed`, async () => {
      for (const retryLegacy of [false, true]) {
        const h = harness(); h.team.team_activity.hasCompletedTrial = pastTrial;
        h.rejectOnce = new Error("network unavailable");
        assert.equal((await h.checkout()).status, 409);
        const key = h.record.idempotencyKey;
        h.record.createdAt = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
        h.record.submittedAt = h.record.createdAt;
        h.enabled = false;
        const result = await h.checkout(retryLegacy ? legacyBody({
          mode: pastTrial ? "Normal" : "Trial", priceId: pastTrial ? "price_pro_month" : "price_legacy_trial",
        }) : startBody());
        assert.equal(result.status, retryLegacy ? 200 : 403);
        assert.equal(h.calls.filter((call) => call.key === key).length, 1);
        if (retryLegacy) {
          assert.equal(h.calls.length, 2);
          assert.notEqual(h.record.idempotencyKey, key);
          assert.equal(h.calls[1].payload.metadata.checkoutIntent, undefined);
          assert.equal(h.calls[1].payload.subscription_data?.trial_period_days, pastTrial ? undefined : 14);
        } else {
          assert.equal(h.calls.length, 1);
          assert.equal(h.record, null);
        }
        assert.deepEqual(h.expired, []);
      }
    });
  }
}

test("OFF settles a stale lost-response attempt and refuses a live rollout offer; expiry still allows legacy checkout", async () => {
  const h = harness(); h.timeoutAfterCreate = true;
  assert.equal((await h.checkout()).status, 409);
  const key = h.record.idempotencyKey;
  h.record.createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  h.record.submittedAt = h.record.createdAt;
  h.enabled = false;
  assert.equal((await h.checkout(legacyBody())).status, 409);
  assert.equal(h.record.state, "settled"); assert.equal(h.record.idempotencyKey, key);
  assert.equal(h.record.sessionId, "cs_1");
  assert.equal(h.calls.filter((call) => call.key === key).length, 1);
  assert.deepEqual(h.expired, []);
  h.sessions.get("cs_1").status = "expired";
  assert.equal((await h.checkout(legacyBody())).status, 200);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].payload.subscription_data.trial_period_days, 14);
});

test("OFF settles a stale in-flight key without forgetting a known completed checkout hidden from listings", async () => {
  const h = harness(); h.team.team_activity.hasCompletedTrial = true;
  await h.checkout();
  h.record.state = "in_flight";
  h.record.createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  h.record.submittedAt = h.record.createdAt;
  const completed = h.sessions.get("cs_1");
  completed.status = "complete"; completed.subscription = "sub_started";
  h.hidden = true; h.enabled = false;
  const normal = legacyBody({ mode: "Normal", priceId: "price_pro_month" });
  const result = await h.checkout(normal);
  assert.equal(result.status, 409); assert.equal(result.body.finishing, true);
  assert.equal(h.record.state, "settled"); assert.equal(h.calls.length, 1);
  assert.deepEqual(h.expired, []);
  h.hidden = false; h.subscriptions = [subscription("canceled", { id: "sub_started" })];
  assert.equal((await h.checkout(normal)).status, 200);
  assert.equal(h.calls.length, 2);
});

for (const savedSessionId of [false, true]) {
  test(`OFF retains a stale completed in-flight checkout with saved id=${savedSessionId} and refuses a second price; cancellation still allows it`, async () => {
    const h = harness(); h.team.team_activity.hasCompletedTrial = true;
    await h.checkout();
    const key = h.record.idempotencyKey;
    h.record.state = "in_flight";
    h.record.createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    h.record.submittedAt = h.record.createdAt;
    if (!savedSessionId) delete h.record.sessionId;
    const completed = h.sessions.get("cs_1");
    completed.status = "complete"; completed.subscription = "sub_started";
    h.hidden = savedSessionId; h.enabled = false;
    h.subscriptions = [subscription("active", { id: "sub_started" })];
    const normal = legacyBody({ mode: "Normal", priceId: "price_pro_year" });
    const refused = await h.checkout(normal);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.message, "An existing subscription needs billing recovery");
    assert.equal(h.record.state, "settled"); assert.equal(h.record.idempotencyKey, key);
    assert.equal(h.calls.length, 1); assert.deepEqual(h.expired, []);
    h.subscriptions = [subscription("canceled", { id: "sub_started" })];
    assert.equal((await h.checkout(normal)).status, 200);
    assert.equal(h.calls.length, 2); assert.notEqual(h.record.idempotencyKey, key);
    assert.equal(h.calls[1].payload.line_items[0].price, "price_pro_year");
  });
}

test("OFF preserves known seven-day sessions and orphan offers, never adopting them into fresh legacy requests", async () => {
  for (const orphan of [false, true]) {
    const h = harness(); const original = await h.checkout(); h.enabled = false;
    if (orphan) h.record = null;
    assert.equal((await h.checkout(legacyBody())).status, 409);
    assert.deepEqual(h.expired, []);
    assert.equal(h.calls.length, 1);
    if (!orphan) assert.equal((await h.checkout()).body.url, original.body.url);
  }
});

test("legacy missing-field in-flight attempts replay the exact old wire payload and original key before a new selection", async () => {
  const h = harness(); h.enabled = false; h.hidden = true;
  const desired = { teamId: "team-owned", customerId: "cus_owned", googleAccountId: "account-owned",
    quantity: 3, priceId: "price_legacy_trial", checkoutMode: "Trial",
    returnUrl: legacyBody().returnUrl, cancelUrl: legacyBody().cancelUrl };
  h.record = { ...h.reservations.createCheckoutAttempt(desired), state: "in_flight" };
  const key = h.record.idempotencyKey;
  const wire = {
    mode: "subscription", customer: "cus_owned", line_items: [{ quantity: 3, price: "price_legacy_trial", adjustable_quantity: { enabled: true, minimum: 3 } }],
    success_url: desired.returnUrl, cancel_url: desired.cancelUrl, allow_promotion_codes: true, payment_method_collection: "always",
    subscription_data: { trial_period_days: 14, trial_settings: { end_behavior: { missing_payment_method: "create_invoice" } } },
    metadata: { teamId: "team-owned", googleAccountId: "account-owned", stripe_customer_id: "cus_owned", priceId: "price_legacy_trial",
      checkoutMode: "Trial", checkoutQuantity: "3", checkoutAttemptId: h.record.attemptId },
  };
  h.payloads.set(key, structuredClone(wire));
  h.sessions.set("cs_legacy", { id: "cs_legacy", key, status: "open", url: "https://checkout.stripe.test/legacy",
    customer: wire.customer, metadata: wire.metadata, success_url: wire.success_url, cancel_url: wire.cancel_url });
  assert.equal((await h.checkout(legacyBody())).status, 200);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].key, key);
  assert.deepEqual(h.calls[0].payload, wire);
  assert.equal(h.record.desired.trialDays, undefined);
  assert.equal(h.calls[0].payload.metadata.trialDays, undefined);
  assert.equal(h.calls[0].payload.metadata.checkoutIntent, undefined);
});

test("ambiguous recovery remains 409 with original key; lock loss cannot settle or replace it", async () => {
  const h = harness(); h.rejectOnce = Object.assign(new Error("busy"), { statusCode: 409 });
  assert.equal((await h.checkout()).status, 409);
  const original = h.record.idempotencyKey;
  h.rejectOnce = new Error("network"); h.enabled = false;
  assert.equal((await h.checkout(legacyBody())).status, 409);
  assert.equal(h.record.idempotencyKey, original);
  assert.deepEqual(h.calls.map(({ key }) => key), [original, original]);
  assert.deepEqual(h.expired, []);
  const lost = harness(); lost.beforeCreate = async () => { lost.lost = true; };
  await assert.rejects(lost.checkout(), { name: "CheckoutReservationLockLostError" });
  assert.equal(lost.record.state, "in_flight");
  const savedKey = lost.record.idempotencyKey; lost.beforeCreate = null; lost.lost = false;
  assert.equal((await lost.checkout()).status, 200);
  assert.equal(lost.record.idempotencyKey, savedKey);
  assert.equal(lost.sessions.size, 1);
});

for (const hidden of [false, true]) {
  for (const listing of ["empty", "stale"]) {
    for (const enabledAfterCancellation of [true, false]) {
      test(`completed Start-plan Normal refuses legacy Normal with ${listing} subscriptions and session listing hidden=${hidden}; reconciled cancellation still allows a new purchase (flag ${enabledAfterCancellation})`, async () => {
        const h = harness(); h.team.team_activity.hasCompletedTrial = true;
        assert.equal((await h.checkout()).status, 200);
        assert.equal(h.calls[0].payload.subscription_data, undefined);
        const key = h.record.idempotencyKey;
        const completed = h.sessions.get("cs_1");
        completed.status = "complete"; completed.subscription = "sub_started";
        h.hidden = hidden;
        h.subscriptions = listing === "empty" ? [] : [subscription("canceled", { id: "sub_unrelated" })];
        const normal = legacyBody({ mode: "Normal", priceId: "price_pro_month" });
        for (const enabled of [true, false]) {
          h.enabled = enabled;
          const refused = await h.checkout(normal);
          assert.equal(refused.status, 409);
          assert.equal(refused.body.finishing, true);
          assert.equal(h.record.idempotencyKey, key);
          assert.equal(h.calls.length, 1);
          assert.deepEqual(h.expired, []);
        }
        h.subscriptions = [subscription("canceled", { id: "sub_started" })];
        h.enabled = enabledAfterCancellation;
        const allowed = await h.checkout(normal);
        assert.equal(allowed.status, 200);
        assert.equal(allowed.body.alreadySubscribed, undefined);
        assert.equal(h.calls.length, 2);
        assert.notEqual(h.record.idempotencyKey, key);
        assert.deepEqual(h.expired, []);
      });
    }
  }
}

test("completed orphan Start-plan Normal is refused through legacy Normal until cancellation is reconciled", async () => {
  const h = harness(); h.team.team_activity.hasCompletedTrial = true;
  await h.checkout(); h.record = null;
  const completed = h.sessions.get("cs_1");
  completed.status = "complete"; completed.subscription = "sub_started";
  const normal = legacyBody({ mode: "Normal", priceId: "price_pro_month" });
  const refused = await h.checkout(normal);
  assert.equal(refused.status, 409); assert.equal(refused.body.finishing, true);
  assert.equal(h.calls.length, 1); assert.equal(h.record, null);
  h.subscriptions = [subscription("canceled", { id: "sub_started" })];
  assert.equal((await h.checkout(normal)).status, 200);
  assert.equal(h.calls.length, 2);
});

test("OPEN Normal checkout reuse stays intent-separated; same-intent retry remains allowed", async () => {
  const h = harness(); h.team.team_activity.hasCompletedTrial = true;
  const first = await h.checkout();
  assert.equal((await h.checkout()).body.url, first.body.url);
  assert.equal(h.calls.length, 1);
  const legacy = await h.checkout(legacyBody({ mode: "Normal", priceId: "price_pro_month" }));
  assert.equal(legacy.status, 200);
  assert.notEqual(legacy.body.url, first.body.url);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.expired, ["cs_1"]);
  assert.equal(h.calls[1].payload.metadata.checkoutIntent, undefined);
});

test("completed trials are never shortened/replaced, even with stale subscription listings or changed desired terms", async () => {
  const h = harness(); await h.checkout();
  const original = h.record.attemptId;
  h.sessions.get("cs_1").status = "complete"; h.sessions.get("cs_1").subscription = "sub_started";
  h.seats = 10;
  assert.equal((await h.checkout()).status, 409);
  const preview = await h.checkout(startBody({ action: "preview" }));
  assert.equal(preview.body.finishing, true);
  h.enabled = false;
  assert.equal((await h.checkout()).status, 409);
  assert.equal(h.calls.length, 1); assert.deepEqual(h.expired, []);
  assert.equal(h.record.attemptId, original);
});

test("agent and cross-origin requests are refused at the signed-session boundary; same-origin human owner is still allowed", async () => {
  const h = harness();
  let session = { id: 6, agentId: "agent" };
  const route = load("src/pages/api/stripe/session/checkout.ts", {
    "@/lib/flags": { isFeatureEnabled: async (key, id) => { assert.equal(key, flag.HTPR_7551_START_PLAN_CHECKOUT_FLAG); assert.equal(id, 6); return h.enabled; } },
    "@/lib/flags/keys": flag,
    "@/lib/demo/guestGuard": { isGuestRequest: async () => false },
    "@/lib/auth/session": { SESSION_COOKIE: "ht_session", verifySession: () => session },
    "@/utils/controllers/stripe/createAuthorizedCheckoutSession": { createAuthorizedCheckoutSession: (_id, body) => h.checkout(body) },
  }).default;
  const invoke = async (origin) => {
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await route({ method: "POST", headers: { origin }, cookies: {}, body: startBody() }, res);
    return res;
  };
  assert.equal((await invoke("https://app.hypertask.ai")).code, 403);
  session = { id: 6 };
  assert.equal((await invoke("https://evil.test")).code, 403);
  assert.equal((await invoke(undefined)).code, 403);
  assert.equal(h.calls.length, 0);
  assert.equal((await invoke("https://app.hypertask.ai")).code, 200);
});


test("orphan reuse checks every checkout page, including pages containing only another team's sessions", async () => {
  const h = harness(); const first = await h.checkout(); h.record = null;
  h.sessionPages = [
    { data: [{ id: "cs_other", metadata: { teamId: "another-team" }, status: "open" }], has_more: true },
    { data: [h.sessions.get("cs_1")], has_more: false },
  ];
  const retry = await h.checkout();
  assert.equal(retry.body.url, first.body.url);
  assert.equal(h.calls.length, 1);
  assert.equal(h.sessionRequests.at(-1).starting_after, "cs_other");
  assert.deepEqual(h.expired, []);
});

test("OFF can start a new fourteen-day legacy attempt only after an old seven-day offer has actually expired", async () => {
  const h = harness(); await h.checkout(); h.enabled = false;
  assert.equal((await h.checkout(legacyBody())).status, 409);
  const oldKey = h.record.idempotencyKey;
  h.sessions.get("cs_1").status = "expired";
  assert.equal((await h.checkout(legacyBody())).status, 200);
  assert.notEqual(h.record.idempotencyKey, oldKey);
  assert.equal(h.calls.at(-1).payload.subscription_data.trial_period_days, 14);
  assert.deepEqual(h.expired, []);
});

test("completed legacy fourteen-day trial cannot be replaced by a seven-day legacy request when Stripe's subscription list lags", async () => {
  const h = harness(); h.enabled = false;
  await h.checkout(legacyBody());
  const key = h.record.idempotencyKey;
  h.sessions.get("cs_1").status = "complete"; h.sessions.get("cs_1").subscription = "sub_legacy";
  h.enabled = true; h.hidden = true;
  assert.equal((await h.checkout(legacyBody())).status, 409);
  assert.equal(h.record.idempotencyKey, key);
  assert.equal(h.calls.length, 1); assert.deepEqual(h.expired, []);
});

test("a canceled completed trial offers monthly checkout, and a stale non-entitling plan pointer does not refuse a Free team", async () => {
  const h = harness(); await h.checkout();
  h.sessions.get("cs_1").status = "complete"; h.sessions.get("cs_1").subscription = "sub_cancelled";
  h.subscriptions = [subscription("canceled", { id: "sub_cancelled", trial_start: 1, trial_end: 2 })];
  assert.equal((await h.checkout(startBody({ action: "preview" }))).body.trialDays, 0);
  assert.equal((await h.checkout()).status, 200);
  assert.equal(h.calls.at(-1).payload.subscription_data, undefined);
  const stale = harness(); stale.team.activeSubscriptionPlanId = "sub_old";
  stale.team.subscriptionPlan = [{ subscriptionId: "sub_old", subscriptionStatus: "canceled", priceId: "price_pro_month" }];
  assert.equal((await stale.checkout()).status, 200);
  assert.equal(stale.calls[0].payload.subscription_data.trial_period_days, 7);
});

test("unsigned and guest requests remain refused while a signed non-guest owner remains allowed", async () => {
  const h = harness(); let session = null; let guest = false;
  const route = load("src/pages/api/stripe/session/checkout.ts", {
    "@/lib/auth/session": { SESSION_COOKIE: "ht_session", verifySession: () => session },
    "@/lib/flags": { isFeatureEnabled: async (key, id) => { assert.equal(key, flag.HTPR_7551_START_PLAN_CHECKOUT_FLAG); assert.equal(id, 6); return h.enabled; } },
    "@/lib/flags/keys": flag,
    "@/lib/demo/guestGuard": { GUEST_FORBIDDEN_MESSAGE: "Guests cannot buy plans", isGuestRequest: async () => guest },
    "@/utils/controllers/stripe/createAuthorizedCheckoutSession": { createAuthorizedCheckoutSession: (_id, body) => h.checkout(body) },
  }).default;
  const invoke = async () => {
    const res = { status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    await route({ method: "POST", cookies: {}, headers: { origin: "https://app.hypertask.ai", authorization: "Bearer agent-token-fixture" }, body: startBody() }, res);
    return res;
  };
  assert.equal((await invoke()).code, 401);
  session = { id: 6 }; guest = true;
  assert.equal((await invoke()).code, 403);
  assert.equal(h.calls.length, 0);
  guest = false; assert.equal((await invoke()).code, 200);
});


test("already-admitted past-trial monthly intent also recovers its frozen non-adjustable payload after OFF", async () => {
  const h = harness(); h.team.team_activity.hasCompletedTrial = true;
  h.timeoutAfterCreate = true; h.hidden = true;
  assert.equal((await h.checkout()).status, 409);
  const key = h.record.idempotencyKey;
  h.enabled = false;
  assert.equal((await h.checkout()).status, 200);
  assert.deepEqual(h.calls[0], h.calls[1]);
  assert.equal(h.record.idempotencyKey, key);
  assert.equal(h.calls[1].payload.subscription_data, undefined);
  assert.deepEqual(h.calls[1].payload.line_items, [{ quantity: 3, price: "price_pro_month" }]);
  assert.equal((await h.checkout(startBody({ action: "preview" }))).body.trialDays, 0);
  assert.equal((await h.checkout(legacyBody({ mode: "Normal", priceId: "price_pro_month" }))).status, 409);
  assert.deepEqual(h.expired, []);
});


for (const pastTrial of [false, true]) {
  test(`real route recovers an admitted ${pastTrial ? "Normal" : "Trial"} lost-response checkout after OFF without a second session`, async () => {
    const h = harness(); h.team.team_activity.hasCompletedTrial = pastTrial;
    h.timeoutAfterCreate = true; h.hidden = true;
    let session = { id: 6 }, guest = false;
    const route = load("src/pages/api/stripe/session/checkout.ts", {
      "@/lib/auth/session": { SESSION_COOKIE: "ht_session", verifySession: () => session },
      "@/lib/demo/guestGuard": { GUEST_FORBIDDEN_MESSAGE: "Guests cannot buy plans", isGuestRequest: async () => guest },
      "@/utils/controllers/stripe/createAuthorizedCheckoutSession": { createAuthorizedCheckoutSession: (id, body) => h.checkout(body, id) },
    }).default;
    const invoke = async (body = startBody(), origin = "https://app.hypertask.ai") => {
      const res = { status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
      await route({ method: "POST", cookies: { ht_session: "signed-human-fixture" }, headers: { origin }, body }, res);
      return res;
    };
    assert.equal((await invoke()).code, 409);
    const admitted = structuredClone(h.calls[0]);
    const originalSession = h.sessions.get("cs_1");
    assert.equal(h.record.state, "in_flight");
    h.enabled = false;
    assert.equal((await invoke(startBody(), "https://evil.test")).code, 403);
    guest = true; assert.equal((await invoke()).code, 403); guest = false;
    session = { id: 6, agentId: 10 }; assert.equal((await invoke()).code, 403);
    session = { id: 99 }; assert.equal((await invoke()).code, 403);
    session = { id: 6 };
    assert.equal(h.calls.length, 1);
    const recovered = await invoke();
    assert.equal(recovered.code, 200);
    assert.equal(recovered.body.url, originalSession.url);
    assert.equal(h.record.idempotencyKey, admitted.key);
    assert.equal(h.record.sessionId, originalSession.id);
    assert.deepEqual(h.calls, [admitted, admitted]);
    assert.equal(h.sessions.size, 1);
    assert.equal(h.record.state, "settled");
    assert.equal(h.calls[1].payload.subscription_data?.trial_period_days, pastTrial ? undefined : 7);
    assert.deepEqual(h.expired, []);
    assert.equal((await invoke(startBody({ boardUrl: "https://app.hypertask.ai/project?id=7&view=other" }))).code, 409);
    assert.equal(h.calls.length, 2);
  });
}

test("route refuses fresh signup with flag OFF while production legacy checkout remains allowed", async () => {
  const h = harness(); h.enabled = false;
  let forwarded = 0;
  const route = load("src/pages/api/stripe/session/checkout.ts", {
    "@/lib/auth/session": { SESSION_COOKIE: "ht_session", verifySession: () => ({ id: 6 }) },
    "@/lib/flags": { isFeatureEnabled: async (key, id) => {
      assert.equal(key, "htpr-7551-start-plan-checkout"); assert.equal(id, 6); return h.enabled;
    } },
    "@/lib/flags/keys": flag,
    "@/lib/demo/guestGuard": { isGuestRequest: async () => false },
    "@/utils/controllers/stripe/createAuthorizedCheckoutSession": { createAuthorizedCheckoutSession: (_id, body) => { forwarded++; return h.checkout(body); } },
  }).default;
  const invoke = async (body) => {
    const res = { status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    await route({ method: "POST", cookies: {}, headers: { origin: "https://app.hypertask.ai" }, body }, res);
    return res;
  };
  const refused = await invoke(startBody());
  assert.equal(refused.code, 403);
  assert.equal(refused.body.message, "Start plan is not available");
  assert.equal(forwarded, 1); assert.equal(h.calls.length, 0);
  assert.equal(h.locks, 0); assert.deepEqual(h.stripeCalls, []); assert.equal(h.record, null);
  assert.equal((await invoke(legacyBody())).code, 200);
  assert.equal(forwarded, 2);
  assert.equal(h.calls[0].payload.subscription_data.trial_period_days, 14);
  assert.equal(h.calls[0].payload.metadata.trialDays, undefined);
  assert.equal(h.calls[0].payload.metadata.checkoutIntent, undefined);
});

test("an unreadable flag warns and refuses fresh signup without lock or Stripe but still allows production legacy checkout", async (t) => {
  const warning = t.mock.method(console, "warn", () => {});
  const h = harness(); h.flagFailure = true;
  const route = load("src/pages/api/stripe/session/checkout.ts", {
    "@/lib/auth/session": { SESSION_COOKIE: "ht_session", verifySession: () => ({ id: 6 }) },
    "@/lib/demo/guestGuard": { isGuestRequest: async () => false },
    "@/utils/controllers/stripe/createAuthorizedCheckoutSession": { createAuthorizedCheckoutSession: (id, body) => h.checkout(body, id) },
  }).default;
  const invoke = async (body) => {
    const res = { status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    await route({ method: "POST", cookies: {}, headers: { origin: "https://app.hypertask.ai" }, body }, res);
    return res;
  };
  assert.equal((await invoke(startBody())).code, 403);
  assert.equal(h.locks, 0); assert.deepEqual(h.stripeCalls, []); assert.equal(h.record, null);
  assert.equal((await invoke(legacyBody())).code, 200);
  assert.deepEqual(h.flagReads, [6, 6]);
  assert.equal(warning.mock.calls.length, 2);
  for (const call of warning.mock.calls) {
    assert.deepEqual(call.arguments, ["Checkout flag lookup failed; treating Start plan as disabled"]);
  }
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].payload.subscription_data.trial_period_days, 14);
  assert.equal(h.calls[0].payload.line_items[0].price, "price_legacy_trial");
  assert.deepEqual(h.calls[0].payload.line_items[0].adjustable_quantity, { enabled: true, minimum: 3 });
  assert.equal(h.calls[0].payload.metadata.trialDays, undefined);
  assert.equal(h.calls[0].payload.metadata.checkoutIntent, undefined);
});

test("checkout flag independently defaults to Owner-only money risk; QA and ordinary users remain refused", async () => {
  const registry = load("src/lib/flags.ts", {
    "@/lib/prisma": { default: {} },
    "@/lib/flags/definitions": { FEATURE_FLAG_DEFINITIONS: [flag.default] },
    "@/lib/flags/keys": { HTPR_7042_NEON_WORK_AVOIDANCE_FLAG: "htpr-7042-neon-work-avoidance" },
  });
  const key = flag.HTPR_7551_START_PLAN_CHECKOUT_FLAG;
  assert.equal(key, "htpr-7551-start-plan-checkout");
  assert.equal(registry.defaultFeatureFlagMode(key), "OWNER_ONLY");
  assert.equal(flag.default.releaseRisk.highRisk, "money");
  assert.deepEqual(flag.default.releaseRisk.ownerRequest, {
    quote: "this one goes behind a feature flag that is only on for me at first pls. Don't release to everyone right away.",
    ticketUrl: "https://app.hypertask.ai/detail/project-15/7511",
  });
  for (const [id, email, expected] of [[6, "valentin.yeo@gmail.com", true],
    [985, "valentin@hypertask.ai", false], [2343, "normal@example.test", false]]) {
    const db = { featureFlag: { findUnique: async ({ where }) => { assert.equal(where.key, key); return null; } },
      user: { findUnique: async () => ({ id, email }) } };
    assert.equal(await registry.isFeatureEnabled(key, id, db), expected);
    db.featureFlag.findUnique = async () => ({ mode: "OFF" });
    assert.equal(await registry.isFeatureEnabled(key, id, db), false);
  }
});
