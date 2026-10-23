import assert from "node:assert/strict";
import test from "node:test";
import { activationHarness } from "./helpers/activation-harness";

process.env.POSTHOG_SERVER_PROJECT_TOKEN = "mock-local-only";

const flag = "htpr-7294-funnel-probe-category";
const sharedFlag = "htpr-7292-shared-account-category";
const PROBE = 124;
const CUSTOMER = 123;
const probeEmails = [
  "daily@funnel-probe.hypertask.app",
  "daily@signup.funnel-probe.hypertask.app",
  "  Daily@FUNNEL-PROBE.HYPERTASK.APP  ",
];

function harness(probe = true, shared = true) {
  const h = activationHarness();
  h.mocks["@/lib/flags"].HTPR_7294_FUNNEL_PROBE_CATEGORY_FLAG = flag;
  h.setFlagEnabled(flag, probe);
  h.setFlagEnabled(sharedFlag, shared);
  h.users.set(PROBE, { id: PROBE, uid: "real_124", email: probeEmails[0] });
  return h;
}

test("the probe flag is a feature available to Owner and QA by default", () => {
  const definition = harness().load("src/lib/flags/definitions/htpr-7294-funnel-probe-category.ts").default;
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
  assert.equal(definition.description, "Accounts on the funnel-probe.hypertask.app test domain are labelled probe in analytics so the daily test signup never counts as a customer");
});

test("exact and subdomain probe emails are normalized and categorized only when enabled", () => {
  const { accountCategory } = harness().load("src/lib/telemetry/accountCategory.ts");
  for (const email of probeEmails) {
    const user = { id: PROBE, email };
    assert.equal(accountCategory(user, { probeDomain: true }), "probe", email);
    assert.equal(accountCategory(user, { probeDomain: false }), "customer", email);
    assert.equal(accountCategory(user), "customer", email);
  }
});

test("probe domain lookalikes stay customers", () => {
  const { accountCategory } = harness().load("src/lib/telemetry/accountCategory.ts");
  for (const domain of ["funnel-probe.hypertask.app.evil.com", "xfunnel-probe.hypertask.app"]) {
    assert.equal(accountCategory({ id: PROBE, email: `daily@${domain}` }, { probeDomain: true }), "customer", domain);
  }
  assert.equal(accountCategory({ id: PROBE, email: "daily@funnel-probe.hypertask.ai" }, { probeDomain: true }), "internal");
});

test("guest and QA identities take precedence over probe, which precedes internal", () => {
  const { accountCategory } = harness().load("src/lib/telemetry/accountCategory.ts");
  const oldQaEmail = process.env.QA_LOGIN_EMAIL;
  process.env.QA_LOGIN_EMAIL = `  ${probeEmails[0].toUpperCase()}  `;
  try {
    assert.equal(accountCategory({ id: PROBE, email: probeEmails[0] }, { probeDomain: true }), "qa");
    assert.equal(accountCategory({ id: 985, email: probeEmails[1] }, { probeDomain: true }), "qa");
    assert.equal(accountCategory({ id: 2343, email: probeEmails[1] }, { probeDomain: true }), "qa");
    assert.equal(accountCategory({ id: 985, uid: "guest_probe", email: probeEmails[0] }, { probeDomain: true }), "guest");
    assert.equal(accountCategory({ id: PROBE, uid: "guest_probe", email: probeEmails[1] }, { probeDomain: true }), "guest");
    assert.equal(accountCategory({ id: 6, email: probeEmails[1] }, { probeDomain: true }), "probe");
    assert.equal(accountCategory({ id: PROBE, email: "guest@demo.hypertask.ai" }, { probeDomain: true }), "guest");
    assert.equal(accountCategory({ id: PROBE, email: "runner@agents.hypertask.ai" }, { probeDomain: true }), "internal");
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

test("occurrences attach probe with both flags on and still send customer events", async () => {
  for (const enabled of [true, false]) {
    for (const email of probeEmails) {
      const h = harness(enabled);
      h.users.get(PROBE).email = email;
      const { captureAnalyticsOccurrence } = h.load("src/lib/telemetry/analyticsOccurrences.ts");
      for (const userId of [PROBE, CUSTOMER]) {
        await captureAnalyticsOccurrence(userId, "board_created", `board_created:${userId}`, { account_category: null });
      }
      assert.equal(h.captures.length, 2);
      assert.equal(h.captures[0].properties.account_category, enabled ? "probe" : "customer", email);
      assert.equal(h.captures[1].properties.account_category, "customer");
      assert.ok(h.flagChecks.some((check) => check.key === flag && check.userId === PROBE));
    }
  }
});

test("probe users remain activation eligible and their activation events fire", async () => {
  for (const enabled of [true, false]) {
    const h = harness(enabled);
    const { isActivationEligible } = h.load("src/lib/telemetry/activationAnalytics.ts");
    assert.equal(await isActivationEligible(PROBE), true);
    assert.ok(h.flagChecks.some((check) => check.key === flag && check.userId === PROBE));
    h.capture.activation(PROBE, "board_created", "15", { source: "manual" });
    await h.drain();
    assert.equal(h.captures.length, 1);
    assert.equal(h.captures[0].event, "board_created");
    assert.equal(h.captures[0].properties.account_category, enabled ? "probe" : "customer");
  }
});

test("the shared-category flag off preserves legacy behavior without evaluating the probe flag", async () => {
  const h = harness(true, false);
  const { isActivationEligible } = h.load("src/lib/telemetry/activationAnalytics.ts");
  const { captureAnalyticsOccurrence } = h.load("src/lib/telemetry/analyticsOccurrences.ts");
  const { legacyAccountCategory } = h.load("src/lib/telemetry/savedWorkAnalytics.ts");
  assert.equal(await isActivationEligible(PROBE), true);
  assert.equal(legacyAccountCategory(h.users.get(PROBE)), "customer");
  await captureAnalyticsOccurrence(PROBE, "board_created", "board_created:15", { account_category: "customer" });
  assert.equal(h.captures.length, 1);
  assert.equal(h.captures[0].properties.account_category, "customer");
  assert.equal(h.flagChecks.some((check) => check.key === flag), false);
});
