const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createStore } = require("jotai/vanilla");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;
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

test("the selected settings team survives a full page reload", () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const storageValues = new Map();
  const pagehideListeners = [];
  const storage = {
    getItem: (key) => storageValues.get(key) ?? null,
    setItem: (key, value) => storageValues.set(key, String(value)),
    removeItem: (key) => storageValues.delete(key),
  };

  global.window = {
    localStorage: storage,
    sessionStorage: storage,
    addEventListener: (type, listener) => {
      if (type === "pagehide") pagehideListeners.push(listener);
    },
  };
  global.document = {
    visibilityState: "visible",
    addEventListener: () => {},
  };

  const loadSelectedTeamAtom = () => {
    const freshJiti = require("jiti")(
      path.join(root, `tests/settings-team-reload-${++jitiEntryId}.cjs`),
      {
        interopDefault: true,
        alias: { "@": path.join(root, "src") },
        moduleCache: false,
        jsx: true,
      },
    );
    return freshJiti(path.join(root, "src/store/index.ts"))
      .selectedSettingsTeamIdAtom;
  };

  try {
    const beforeReload = createStore();
    beforeReload.set(loadSelectedTeamAtom(), "team-b");
    pagehideListeners.splice(0).forEach((listener) => listener());

    const afterReload = createStore();
    assert.equal(afterReload.get(loadSelectedTeamAtom()), "team-b");
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
  }
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
