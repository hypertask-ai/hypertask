const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers/start-plan-checkout.cjs");
const boardUrl = "https://app.hypertask.ai/project?id=7&view=default#board";
const signup = (extra = {}) => ({ intent: "signup-straight-to-board", teamId: "team-owned", boardUrl, ...extra });
const legacy = (extra = {}) => ({ teamId: "team-owned", mode: "Trial", priceId: "price_legacy_trial",
  returnUrl: "https://app.hypertask.ai/trial-page-confirmation", cancelUrl: "https://app.hypertask.ai", ...extra });

for (const enabled of [false, true]) {
  test(`new trial terms follow the fourteen-day flag (${enabled}) at both entry points`, async () => {
    for (const body of [signup(), legacy()]) {
      const h = harness(); h.fourteenDayTrial = enabled;
      if (body.intent) {
        assert.deepEqual((await h.checkout(signup({ action: "preview" }))).body,
          { canStartPlan: true, trialDays: enabled ? 14 : 7 });
        assert.equal(h.calls.length, 0); assert.equal(h.record, null);
      }
      assert.equal((await h.checkout(body)).status, 200);
      assert.equal(h.calls[0].payload.subscription_data.trial_period_days, enabled ? 14 : 7);
      assert.equal(h.calls[0].payload.metadata.checkoutIntent,
        body.intent ?? (enabled ? "start-plan" : undefined));
      assert.deepEqual(h.calls[0].payload.line_items[0], body.intent
        ? { price: "price_pro_month", quantity: 3 }
        : { price: "price_legacy_trial", quantity: 3, adjustable_quantity: { enabled: true, minimum: 3 } });
    }
  });
}

test("new duration flag never bypasses rollout eligibility, owner checks or used trials", async () => {
  const h = harness(); h.fourteenDayTrial = true;
  assert.equal((await h.checkout(signup(), 99)).status, 403);
  assert.equal(h.trialFlagReads, undefined);
  assert.equal(h.calls.length, 0);
  assert.equal((await h.checkout()).status, 200);
  assert.deepEqual(h.trialFlagReads, [6]);
  const off = harness(); off.fourteenDayTrial = true; off.enabled = false;
  assert.equal((await off.checkout()).status, 403);
  assert.equal((await off.checkout(legacy())).status, 200);
  assert.equal(off.calls[0].payload.subscription_data.trial_period_days, 14);
  const used = harness(); used.fourteenDayTrial = true; used.team.team_activity.hasCompletedTrial = true;
  assert.equal((await used.checkout(legacy())).status, 409);
  assert.equal((await used.checkout(signup({ action: "preview" }))).body.trialDays, 0);
  assert.equal((await used.checkout()).status, 200);
  assert.equal(used.calls[0].payload.subscription_data, undefined);
});

for (const initial of [false, true]) {
  for (const body of [signup(), legacy()]) {
    test(`saved ${initial ? 14 : 7}-day ${body.intent ?? "legacy"} offer survives flag change and uncertain retry`, async () => {
      const h = harness(); h.fourteenDayTrial = initial; h.timeoutAfterCreate = true;
      assert.equal((await h.checkout(body)).status, 409);
      const original = structuredClone(h.calls[0]);
      h.hidden = true; h.fourteenDayTrial = !initial;
      if (body.intent) assert.equal((await h.checkout(signup({ action: "preview" }))).body.trialDays, initial ? 14 : 7);
      assert.equal((await h.checkout(body)).status, 200);
      assert.equal(h.calls.length, 2); assert.deepEqual(h.calls[1], original);
      assert.equal(h.sessions.size, 1); assert.deepEqual(h.expired, []);
    });
  }
}

for (const enabled of [false, true]) {
  for (const saved of [false, true]) {
    test(`completed fourteen-day legacy checkout blocks duplicate before webhook (rollout=${enabled}, saved=${saved})`, async () => {
      const h = harness(); h.fourteenDayTrial = true;
      await h.checkout(legacy());
      const session = h.sessions.get("cs_1"); session.status = "complete"; session.subscription = "sub_pending";
      if (!saved) h.record = null;
      h.enabled = enabled; h.fourteenDayTrial = false;
      assert.equal((await h.checkout(legacy({ mode: "Normal", priceId: "price_pro_year" }))).status, 409);
      assert.equal(h.calls.length, 1); assert.deepEqual(h.expired, []);
      h.subscriptions = [{ id: "sub_pending", status: "canceled", trial_start: 1, trial_end: 2, items: { data: [] } }];
      assert.equal((await h.checkout(legacy({ mode: "Normal", priceId: "price_pro_year" }))).status, 200);
      assert.equal(h.calls.length, 2);
    });
  }
}

test("Stripe-only historical trial is never expired to change its offered duration", async () => {
  for (const initial of [false, true]) {
    for (const body of [signup(), legacy()]) {
      const h = harness(); h.fourteenDayTrial = initial;
      await h.checkout(body); h.record = null; h.fourteenDayTrial = !initial;
      assert.equal((await h.checkout(body)).status, 409);
      assert.equal(h.calls.length, 1); assert.deepEqual(h.expired, []);
    }
  }
});

test("disabling Start plan preserves an open fourteen-day legacy checkout", async () => {
  const h = harness(); h.fourteenDayTrial = true;
  await h.checkout(legacy()); h.enabled = false; h.fourteenDayTrial = false;
  const resumed = await h.checkout(legacy());
  assert.equal(resumed.status, 200); assert.equal(resumed.body.url, "https://checkout.stripe.test/cs_1");
  assert.equal(h.calls.length, 1); assert.deepEqual(h.expired, []);
});

test("duration flag read failure retains previous terms without bypassing eligibility", async () => {
  const h = harness(); h.trialFlagFailure = true;
  assert.equal((await h.checkout()).status, 200);
  assert.equal(h.calls[0].payload.subscription_data.trial_period_days, 7);
});
