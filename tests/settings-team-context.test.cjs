const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(root, "tests/settings-team-context-entry.cjs"),
  {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  },
);

const {
  getInitialSettingsTeamId,
  getSettingsProjectForTeam,
} = jiti(path.join(root, "src/lib/settingsTeamSelection.ts"));
const { deriveTeamBilling } = jiti(
  path.join(root, "src/lib/deriveCurrentBoardBilling.ts"),
);

const projects = [
  { id: 1, teamId: "team-a", title: "A board" },
  { id: 2, teamId: "team-b", title: "B board" },
  { id: 3, teamId: "team-b", title: "B second board" },
];

test("the selected settings team overrides a stale current board", () => {
  assert.equal(
    getSettingsProjectForTeam("team-b", projects[0], projects)?.id,
    2,
  );
});

test("direct settings loads initialize from the previous accessible board", () => {
  assert.equal(
    getInitialSettingsTeamId(
      ["team-a", "team-b"],
      null,
      projects,
      "3",
    ),
    "team-b",
  );
});

test("settings billing derives a paid plan without a current board", () => {
  const billing = deriveTeamBilling({
    id: "team-b",
    activeSubscriptionPlanId: "sub-b",
    subscriptionPlan: [
      {
        subscriptionId: "sub-b",
        subscriptionStatus: "Active",
        priceId: "price_1QCKkpIhmcH60Vcc2RqVACTc",
      },
    ],
  });

  assert.equal(billing?.teamId, "team-b");
  assert.equal(billing?.storePlanId, "Pro");
});
