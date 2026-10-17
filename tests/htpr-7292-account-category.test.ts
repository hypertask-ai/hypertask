import assert from "node:assert/strict";
import test from "node:test";
import { activationHarness } from "./helpers/activation-harness";

process.env.POSTHOG_SERVER_PROJECT_TOKEN = "mock-local-only";

const flag = "htpr-7292-shared-account-category";
const CUSTOMER = 123;
const SMOKE_QA = 2343;
const AGENT = 501;

function harness(shared = true) {
  const h = activationHarness();
  h.setFlagEnabled(flag, shared);
  h.users.set(SMOKE_QA, { id: SMOKE_QA, uid: "real_2343", email: "qa-normal@example.test" });
  h.users.set(AGENT, { id: AGENT, uid: "real_501", email: "runner-3@agents.hypertask.ai" });
  h.prisma.project_View = { upsert: async () => ({ default_view_id: 1 }) };
  h.projects.get(15).seeded = false;
  return h;
}

function ownBoard(h: ReturnType<typeof harness>, userId: number) {
  h.projects.get(15).ownerId = userId;
  h.projects.get(15).owner = h.users.get(userId);
}

test("one rule classifies every known identity, and real customers stay customers", () => {
  const { accountCategory } = harness().load("src/lib/telemetry/accountCategory.ts");
  const oldQaEmail = process.env.QA_LOGIN_EMAIL;
  process.env.QA_LOGIN_EMAIL = " qa-login@example.test ";
  try {
    for (const [user, expected] of [
      [{ id: 2343, email: "anything@example.test" }, "qa"],
      [{ id: 985, email: "qa@example.test" }, "qa"],
      [{ id: 40, email: "QA-Login@Example.test" }, "qa"],
      [{ id: 6, email: "owner@example.test" }, "internal"],
      [{ id: 41, email: "Someone@Hypertask.ai" }, "internal"],
      [{ id: 42, email: "runner-3@agents.hypertask.ai" }, "internal"],
      [{ id: 43, email: "probe@health.hypertask.ai" }, "internal"],
      [{ id: 44, uid: "guest_x", email: "g@example.test" }, "guest"],
      [{ id: 45, email: "guest+abc@demo.hypertask.ai" }, "guest"],
      [{ id: 46, email: "user@example.test" }, "customer"],
      [{ id: 47, email: "user@nothypertask.ai" }, "customer"],
      [{ id: 48, email: "hypertask.ai@gmail.com" }, "customer"],
    ] as const) {
      assert.equal(accountCategory(user), expected, user.email);
    }
  } finally {
    if (oldQaEmail === undefined) delete process.env.QA_LOGIN_EMAIL;
    else process.env.QA_LOGIN_EMAIL = oldQaEmail;
  }
});

test("before this fix the production smoke QA account and agent subdomains counted as customers", () => {
  const { legacyAccountCategory } = harness().load("src/lib/telemetry/savedWorkAnalytics.ts");
  assert.equal(legacyAccountCategory({ id: SMOKE_QA, email: "qa-normal@example.test" }), "customer");
  assert.equal(legacyAccountCategory({ id: AGENT, email: "runner-3@agents.hypertask.ai" }), "customer");
});

test("activation eligibility refuses the smoke QA account and still allows customers and internal accounts", async () => {
  const h = harness();
  h.users.set(6, { id: 6, uid: "real_6", email: "owner@example.test" });
  const { isActivationEligible } = h.load("src/lib/telemetry/activationAnalytics.ts");
  assert.equal(await isActivationEligible(SMOKE_QA), false);
  assert.equal(await isActivationEligible(985), false);
  assert.equal(await isActivationEligible(CUSTOMER), true);
  assert.equal(await isActivationEligible(6), true);
  assert.equal(await isActivationEligible(AGENT), true);
});

test("with the flag off, eligibility keeps its old answer for the smoke QA account", async () => {
  const { isActivationEligible } = harness(false).load("src/lib/telemetry/activationAnalytics.ts");
  assert.equal(await isActivationEligible(SMOKE_QA), true);
});

test("invite events carry the shared category instead of null", async () => {
  for (const [userId, expected] of [[CUSTOMER, "customer"], [AGENT, "internal"]] as const) {
    const h = harness();
    h.prisma.team.findFirst = async () => null;
    h.load("src/lib/telemetry/inviteAnalytics.ts").recordInviteSent({ id: `invitation-${userId}`, userId, projectId: 15 }, "email");
    await h.drain();
    assert.equal(h.captures.length, 1);
    assert.equal(h.captures[0].event, "invite_sent");
    assert.equal(h.captures[0].properties.account_category, expected);
  }
});

test("smoke QA invites are kept out of the activation and invite funnel", async () => {
  const h = harness();
  h.load("src/lib/telemetry/inviteAnalytics.ts").recordInviteSent({ id: "invitation-qa", userId: SMOKE_QA, projectId: 15 }, "email");
  await h.drain();
  assert.deepEqual(h.captures, []);
});

test("legacy activation events gain the shared category", async () => {
  const h = harness();
  h.load("src/lib/telemetry/activationOccurrences.ts").recordActivationOccurrence(CUSTOMER, "board_created", "15", { source: "manual" });
  await h.drain();
  assert.deepEqual(h.captures.map((capture) => capture.properties), [{ source: "manual", account_category: "customer" }]);
});

test("saved-work board_created labels the smoke QA owner qa instead of customer", async () => {
  for (const [shared, expected] of [[true, "qa"], [false, "customer"]] as const) {
    const h = harness(shared);
    h.setFlagEnabled("htpr-7271-saved-work-events", true);
    ownBoard(h, SMOKE_QA);
    await h.load("src/lib/telemetry/savedWorkAnalytics.ts").captureBoardCreated(15, "manual", { userId: SMOKE_QA }, new Date("2026-10-17T12:00:00Z"));
    await h.drain();
    assert.equal(h.captures.length, 1);
    assert.equal(h.captures[0].properties.account_category, expected);
  }
});

test("a missing user keeps the caller's category rather than inventing one", async () => {
  const h = harness();
  const { captureAnalyticsOccurrence } = h.load("src/lib/telemetry/analyticsOccurrences.ts");
  await captureAnalyticsOccurrence(999, "probe", "analytics:probe", { account_category: null });
  assert.equal(h.captures[0].properties.account_category, null);
});
