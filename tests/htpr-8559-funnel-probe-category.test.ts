import assert from "node:assert/strict";
import test from "node:test";
import { activationHarness } from "./helpers/activation-harness";

process.env.POSTHOG_SERVER_PROJECT_TOKEN = "mock-local-only";

const sharedFlag = "htpr-7292-shared-account-category";
const PROBE = 124;
const CUSTOMER = 123;
const probeEmails = [
  "daily@funnel-probe.hypertask.app",
  "daily@signup.funnel-probe.hypertask.app",
  "  Daily@FUNNEL-PROBE.HYPERTASK.APP  ",
];

function harness(shared = true) {
  const h = activationHarness();
  h.setFlagEnabled(sharedFlag, shared);
  h.users.set(PROBE, { id: PROBE, uid: "real_124", email: probeEmails[0] });
  return h;
}

test("exact and subdomain probe emails are normalized and categorized as probe", () => {
  const { accountCategory } = harness().load("src/lib/telemetry/accountCategory.ts");
  for (const email of probeEmails) {
    const user = { id: PROBE, email };
    assert.equal(accountCategory(user), "probe", email);
  }
});

test("probe domain lookalikes stay customers", () => {
  const { accountCategory } = harness().load("src/lib/telemetry/accountCategory.ts");
  for (const domain of ["funnel-probe.hypertask.app.evil.com", "xfunnel-probe.hypertask.app"]) {
    assert.equal(accountCategory({ id: PROBE, email: `daily@${domain}` }), "customer", domain);
  }
  assert.equal(accountCategory({ id: PROBE, email: "daily@funnel-probe.hypertask.ai" }), "internal");
});

test("guest and QA identities take precedence over probe, which precedes internal", () => {
  const { accountCategory } = harness().load("src/lib/telemetry/accountCategory.ts");
  const oldQaEmail = process.env.QA_LOGIN_EMAIL;
  process.env.QA_LOGIN_EMAIL = `  ${probeEmails[0].toUpperCase()}  `;
  try {
    assert.equal(accountCategory({ id: PROBE, email: probeEmails[0] }), "qa");
    assert.equal(accountCategory({ id: 985, email: probeEmails[1] }), "qa");
    assert.equal(accountCategory({ id: 2343, email: probeEmails[1] }), "qa");
    assert.equal(accountCategory({ id: 985, uid: "guest_probe", email: probeEmails[0] }), "guest");
    assert.equal(accountCategory({ id: PROBE, uid: "guest_probe", email: probeEmails[1] }), "guest");
    assert.equal(accountCategory({ id: 6, email: probeEmails[1] }), "probe");
    assert.equal(accountCategory({ id: PROBE, email: "guest@demo.hypertask.ai" }), "guest");
    assert.equal(accountCategory({ id: PROBE, email: "runner@agents.hypertask.ai" }), "internal");
  } finally {
    if (oldQaEmail === undefined) delete process.env.QA_LOGIN_EMAIL;
    else process.env.QA_LOGIN_EMAIL = oldQaEmail;
  }
});

test("probe is not synthetic and QA and guest suppression stays intact", () => {
  const { isSyntheticAccount } = harness().load("src/lib/telemetry/accountCategory.ts");
  assert.equal(isSyntheticAccount("probe"), false);
  assert.equal(isSyntheticAccount("qa"), true);
  assert.equal(isSyntheticAccount("guest"), true);
});

test("occurrences attach probe and still send customer events", async () => {
  for (const email of probeEmails) {
    const h = harness();
    h.users.get(PROBE).email = email;
    const { captureAnalyticsOccurrence } = h.load("src/lib/telemetry/analyticsOccurrences.ts");
    for (const userId of [PROBE, CUSTOMER]) {
      await captureAnalyticsOccurrence(userId, "board_created", `board_created:${userId}`, { account_category: null });
    }
    assert.equal(h.captures.length, 2);
    assert.equal(h.captures[0].properties.account_category, "probe", email);
    assert.equal(h.captures[1].properties.account_category, "customer");
  }
});

test("probe users remain activation eligible and their activation events fire as probe", async () => {
  const h = harness();
  const { isActivationEligible } = h.load("src/lib/telemetry/activationAnalytics.ts");
  assert.equal(await isActivationEligible(PROBE), true);
  h.capture.activation(PROBE, "board_created", "15", { source: "manual" });
  await h.drain();
  assert.equal(h.captures.length, 1);
  assert.equal(h.captures[0].event, "board_created");
  assert.equal(h.captures[0].properties.account_category, "probe");
});

test("the shared-category flag off preserves legacy behavior", async () => {
  const h = harness(false);
  const { isActivationEligible } = h.load("src/lib/telemetry/activationAnalytics.ts");
  const { captureAnalyticsOccurrence } = h.load("src/lib/telemetry/analyticsOccurrences.ts");
  const { legacyAccountCategory } = h.load("src/lib/telemetry/savedWorkAnalytics.ts");
  assert.equal(await isActivationEligible(PROBE), true);
  assert.equal(legacyAccountCategory(h.users.get(PROBE)), "customer");
  await captureAnalyticsOccurrence(PROBE, "board_created", "board_created:15", { account_category: "customer" });
  assert.equal(h.captures.length, 1);
  assert.equal(h.captures[0].properties.account_category, "customer");
});
