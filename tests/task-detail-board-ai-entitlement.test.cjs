const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.join(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const { taskDetailInclude } = jiti(
  path.join(root, "src/utils/controllers/taskDetail/load.ts"),
);
const { deriveCurrentBoardBilling } = jiti(
  path.join(root, "src/lib/deriveCurrentBoardBilling.ts"),
);
const { resolveTaskWriterBoardContext } = jiti(
  path.join(root, "src/lib/ai/taskWriterBoardContext.ts"),
);
const { getDefaultAiModelOptionForPlan } = jiti(
  path.join(root, "src/lib/aiModelOptions.ts"),
);

const teamSelect = () => taskDetailInclude(6, 15).project.select.team.include;

test("task detail SSR sends the board's subscription and BYOK state", () => {
  const team = teamSelect();
  assert.deepEqual(team.subscriptionPlan, {
    select: {
      priceId: true,
      subscriptionId: true,
      subscriptionStatus: true,
    },
    orderBy: { subscriptionStaretdAt: "desc" },
  });
  assert.deepEqual(team.byokApiKeys, {
    select: { provider: true, enabled: true },
  });
});

test("a paid board opened from a board-agnostic view keeps its premium models", () => {
  // Shaped exactly like the SSR payload the detail page writes into
  // currentProjectAtom, with no board page visited first.
  const ssrProject = {
    id: 339,
    teamId: "paid-team",
    team: {
      id: "paid-team",
      activeSubscriptionPlanId: "sub-inne",
      subscriptionPlan: [
        {
          subscriptionId: "sub-inne",
          subscriptionStatus: "active",
          priceId: "price_1QCKkpIhmcH60Vcc2RqVACTc",
        },
      ],
      byokApiKeys: [{ provider: "openai", enabled: true }],
    },
    ai_custom_instructions: [{ model_selected: null }],
  };

  const openBilling = deriveCurrentBoardBilling(ssrProject);
  assert.equal(openBilling.storePlanId, "Pro");

  const context = resolveTaskWriterBoardContext({
    destinationProject: undefined,
    openProject: ssrProject,
    openBilling,
  });
  assert.equal(context.teamId, "paid-team");
  assert.equal(context.billing.storePlanId, "Pro");
  assert.notEqual(
    getDefaultAiModelOptionForPlan(context.billing.storePlanId, false).id,
    getDefaultAiModelOptionForPlan("Free", false).id,
  );
});

test("dropping the subscription rows is what downgraded the picker to the free default", () => {
  const strippedProject = {
    id: 339,
    teamId: "paid-team",
    team: { id: "paid-team", activeSubscriptionPlanId: "sub-inne" },
  };
  const billing = deriveCurrentBoardBilling(strippedProject);
  assert.equal(billing.storePlanId, "Free");
  assert.equal(
    getDefaultAiModelOptionForPlan(billing.storePlanId, false).id,
    "gpt-5.4-mini",
  );
});
