const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const React = require("react");
const { createJiti } = require("jiti");
const { JSDOM } = require("jsdom");
const { createRoot } = require("react-dom/client");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const INTERNAL_TEAM_ID = "08f79efd-770e-4e32-9728-65e6d29ec893";
const PRO_PRICE = "price_1QjJeDIhmcH60VcciHzZ3mTJ";

function internalTeam(overrides = {}) {
  return {
    id: INTERNAL_TEAM_ID,
    activeSubscriptionPlanId: null,
    compedUntil: null,
    compedPlan: null,
    subscriptionPlan: [],
    ...overrides,
  };
}

const savedPro = {
  activeSubscriptionPlanId: "sub_internal_pro",
  subscriptionPlan: [
    { subscriptionId: "sub_internal_pro", subscriptionStatus: "active", priceId: PRO_PRICE },
  ],
};

const FUTURE = () => new Date(Date.now() + 86_400_000);
const canceledPro = {
  activeSubscriptionPlanId: "sub_internal_pro",
  subscriptionPlan: [
    { subscriptionId: "sub_internal_pro", subscriptionStatus: "canceled", priceId: PRO_PRICE },
  ],
};

function loadPlanGate(teamRow) {
  return loadModule("src/app/api/ai/_lib/planGate.ts", {
    "@/lib/prisma": {
      default: {
        project: { findUnique: async () => ({ team: teamRow }) },
        team: { findUnique: async () => teamRow },
      },
    },
  });
}

function loadQuota(teams) {
  return loadModule("src/utils/controllers/projects/boardQuota.ts", {
    "@/lib/prisma": { default: { team: { findMany: async () => teams } } },
    "@/lib/flags": { isFeatureEnabled: async () => false },
  });
}

test("the internal team keeps Pro from its saved subscription", async () => {
  const team = internalTeam(savedPro);
  const { storePlanIdForProject } = loadPlanGate(team);
  const { deriveCurrentBoardBilling } = loadModule("src/lib/deriveCurrentBoardBilling.ts");

  assert.equal(await storePlanIdForProject(null, INTERNAL_TEAM_ID), "Pro");
  assert.equal(await storePlanIdForProject(15, INTERNAL_TEAM_ID), "Pro");
  const billing = deriveCurrentBoardBilling({ id: 15, teamId: INTERNAL_TEAM_ID, team }, true);
  assert.equal(billing.storePlanId, "Pro");
  assert.equal(billing.billingInterval, "month");
});

test("the internal team keeps Pro from a comp", async () => {
  const team = internalTeam({ compedUntil: FUTURE(), compedPlan: "Pro" });
  const { storePlanIdForProject } = loadPlanGate(team);

  assert.equal(await storePlanIdForProject(15, INTERNAL_TEAM_ID), "Pro");
});

test("the internal team id alone does not grant Pro", async () => {
  const team = internalTeam();
  const { storePlanIdForProject } = loadPlanGate(team);
  const { deriveCurrentBoardBilling } = loadModule("src/lib/deriveCurrentBoardBilling.ts");

  assert.equal(await storePlanIdForProject(null, INTERNAL_TEAM_ID), "Free");
  assert.equal(await storePlanIdForProject(15, INTERNAL_TEAM_ID), "Free");
  assert.equal(
    deriveCurrentBoardBilling({ id: 15, teamId: INTERNAL_TEAM_ID, team }, true).storePlanId,
    "Free",
  );
});

test("a canceled subscription on the internal team grants nothing", async () => {
  const team = internalTeam(canceledPro);
  const { storePlanIdForProject } = loadPlanGate(team);

  assert.equal(await storePlanIdForProject(15, INTERNAL_TEAM_ID), "Free");
});

test("board admission follows the saved plan", async () => {
  const internal = { id: INTERNAL_TEAM_ID, compedUntil: null, subscriptionPlan: [] };

  assert.equal(await loadQuota([internal]).hasPaidPlan(1), false);
  assert.equal(await loadQuota([{ ...internal, compedUntil: FUTURE() }]).hasPaidPlan(1), true);
  assert.equal(
    await loadQuota([{ ...internal, subscriptionPlan: [{ subscriptionStatus: "active" }] }]).hasPaidPlan(1),
    true,
  );
});

test("other teams stay on their own saved plan", async () => {
  const other = { ...internalTeam(), id: "other-team" };
  const { storePlanIdForProject } = loadPlanGate(other);

  assert.equal(await storePlanIdForProject(null, "other-team"), "Free");
  assert.equal(
    await loadQuota([{ id: "other-team", compedUntil: null, subscriptionPlan: [] }]).hasPaidPlan(1),
    false,
  );
});

test("a missing internal team row does not fall back to Pro", async () => {
  const { storePlanIdForProject } = loadPlanGate(null);

  assert.equal(await storePlanIdForProject(null, INTERNAL_TEAM_ID), "Free");
});

test("the open board billing chip uses the saved plan with no safety switch", async () => {
  const atoms = {
    currentUserAtom: Symbol("user"),
    currentProjectAtom: Symbol("project"),
    currentBoardBillingAtom: Symbol("billing"),
  };
  const state = { project: { id: 15, teamId: INTERNAL_TEAM_ID, team: internalTeam() } };
  const seen = [];
  const emptyFavorites = [];
  const favoritesResult = { data: emptyFavorites };
  const ignore = () => {};
  const recordBilling = (value) => {
    if (seen.at(-1) !== value) seen.push(value);
  };
  const modules = new Map([
    ["src/store/index.ts", atoms],
    ["src/lib/state.tsx", {
      useRecoilState: (atom) => [atom === atoms.currentProjectAtom ? state.project : null, ignore],
      useSetRecoilState: (atom) => (atom === atoms.currentBoardBillingAtom ? recordBilling : ignore),
    }],
    ["src/hooks/MultiPages/useGetAllFavorites.ts", { useGetAllFavorites: () => favoritesResult }],
  ]);
  const previous = [];
  const globals = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"];
  const previousGlobals = globals.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]);
  let reactRoot;
  let dom;
  try {
    for (const [relative, exports] of modules) {
      const filename = path.join(root, relative);
      previous.push([filename, require.cache[filename]]);
      require.cache[filename] = { id: filename, filename, loaded: true, exports };
    }
    const navigation = path.join(root, "node_modules/next/navigation.js");
    previous.push([navigation, require.cache[navigation]]);
    require.cache[navigation] = {
      id: navigation,
      filename: navigation,
      loaded: true,
      exports: { usePathname: () => "/project", useSearchParams: () => new URLSearchParams("id=15") },
    };
    const useGlobalProvider = createJiti(__filename, {
      interopDefault: true,
      alias: { "@": path.join(root, "src"), "next/navigation": navigation },
    })(path.join(root, "src/components/ProviderGlobal/useGlobalProvider.ts")).default;
    const Shell = () => {
      useGlobalProvider();
      return React.createElement("div");
    };
    dom = new JSDOM("<div id=\"root\"></div>", { url: "https://app.hypertask.ai/project?id=15" });
    Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
    await React.act(async () => {
      reactRoot = createRoot(document.getElementById("root"));
      reactRoot.render(React.createElement(Shell));
    });
    assert.equal(seen.at(-1)?.storePlanId, "Free");
    state.project = { id: 15, teamId: INTERNAL_TEAM_ID, team: internalTeam(savedPro) };
    await React.act(async () => {
      reactRoot.render(React.createElement(Shell));
    });
    assert.equal(seen.at(-1)?.storePlanId, "Pro");
    assert.equal(seen.at(-1)?.billingInterval, "month");
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    dom?.window.close();
    for (const [filename, cached] of previous) {
      if (cached) require.cache[filename] = cached;
      else delete require.cache[filename];
    }
    for (const [name, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
  }
});
