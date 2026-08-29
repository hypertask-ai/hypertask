const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const {
  buildTaskWriterRequestScope,
  resolveTaskWriterBoardContext,
} = jiti(path.join(root, "src/lib/ai/taskWriterBoardContext.ts"));
const { getAiModelPreferenceIds } = jiti(
  path.join(root, "src/lib/aiModelPreferences.ts"),
);
const { isByokProviderEnabledForSource } = jiti(
  path.join(root, "src/lib/byokSelectedProviderGate.ts"),
);
const { teamBillingSnapshotSelect } = jiti(
  path.join(root, "src/lib/ai/teamBillingSnapshotSelect.ts"),
);

test("minimal board payload includes the fields needed for destination AI access", () => {
  assert.deepEqual(teamBillingSnapshotSelect, {
    id: true,
    title: true,
    activeSubscriptionPlanId: true,
    compedUntil: true,
    subscriptionPlan: {
      select: {
        priceId: true,
        subscriptionId: true,
        subscriptionStatus: true,
      },
      orderBy: { subscriptionStaretdAt: "desc" },
    },
    byokApiKeys: {
      select: {
        provider: true,
        enabled: true,
      },
    },
  });
});

test("destination board controls Task Writer entitlement and request scope", () => {
  const openProject = {
    id: 15,
    teamId: "free-team",
    team: { id: "free-team", subscriptionPlan: [], byokApiKeys: [] },
    ai_custom_instructions: [{ model_selected: "free-model" }],
  };
  const destinationProject = {
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
    ai_custom_instructions: [{ model_selected: "paid-default" }],
  };
  const context = resolveTaskWriterBoardContext({
    destinationProject,
    openProject,
    openBilling: null,
  });

  assert.equal(context.project.id, 339);
  assert.equal(context.teamId, "paid-team");
  assert.equal(context.billing.storePlanId, "Pro");
  assert.equal(context.boardDefaultId, "paid-default");
  assert.equal(
    getAiModelPreferenceIds(
      {
        teams: {
          "free-team": { taskWriter: "free-choice" },
          "paid-team": { taskWriter: "paid-choice" },
        },
      },
      "taskWriter",
      context.teamId,
    ).teamScoped,
    "paid-choice",
  );
  assert.equal(
    isByokProviderEnabledForSource(
      context.billing.byokProviderFlags,
      "openai",
    ),
    true,
  );
  assert.deepEqual(buildTaskWriterRequestScope(context.project, context.billing), {
    projectId: 339,
    teamId: "paid-team",
    byokProviderFlags: [{ provider: "openai", enabled: true }],
  });
});

test("switching the global writer destination changes its live entitlement and request", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://app.hypertask.ai/detail/project-15",
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.navigator = dom.window.navigator;
  global.DOMParser = dom.window.DOMParser;
  global.FileReader = dom.window.FileReader;
  global.IS_REACT_ACT_ENVIRONMENT = true;

  const React = require("react");
  const { act } = React;
  const { createRoot } = require("react-dom/client");
  const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
  const axios = require("axios");
  require("tsx/cjs");
  const { RecoilRoot } = require(path.join(root, "src/lib/state.tsx"));
  const {
    AITaskWriterProvider,
    useAITaskWriterContext,
  } = require(
    path.join(root, "src/lib/contexts/TaskDetail/AITaskWriterContext.tsx"),
  );

  const requests = [];
  global.fetch = async (_url, init) => {
    requests.push({ payload: JSON.parse(init.body), signal: init.signal });
    return new Response("generated", { status: 200 });
  };
  const originalAxiosGet = axios.get;
  axios.get = async (url) => ({
    data: url.includes("aiFeatureModels") ? {} : { settings: {} },
  });

  let writer;
  const Probe = () => {
    writer = useAITaskWriterContext();
    return null;
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const reactRoot = createRoot(document.getElementById("root"));
  const project = (id, teamId, model, paid) => ({
    id,
    teamId,
    team: {
      id: teamId,
      compedUntil: paid
        ? new Date(Date.now() + 60_000).toISOString()
        : undefined,
      subscriptionPlan: [],
      byokApiKeys: paid
        ? [{ provider: "openai", enabled: true }]
        : [],
    },
    ai_custom_instructions: [{ model_selected: model }],
  });
  const renderWriter = (destination) =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        RecoilRoot,
        null,
        React.createElement(
          AITaskWriterProvider,
          { defaultMode: "AiTaskWriter", project: destination },
          React.createElement(Probe),
        ),
      ),
    );

  try {
    await act(async () => {
      reactRoot.render(renderWriter(project(15, "free-team", "free-model", false)));
    });
    assert.equal(writer.modelTeamId, "free-team");
    assert.notEqual(writer.modelBilling?.storePlanId, "Pro");

    await act(async () => {
      reactRoot.render(renderWriter(project(339, "paid-team", "paid-default", true)));
    });
    assert.equal(writer.modelTeamId, "paid-team");
    assert.equal(writer.modelBilling.storePlanId, "Pro");
    assert.equal(
      writer.modelBilling.byokProviderFlags.find(
        ({ provider }) => provider === "openai",
      ).enabled,
      true,
    );

    await act(async () => {
      await writer.sendAIRequest("Create the destination task");
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].payload.projectId, 339);
    assert.equal(requests[0].payload.teamId, "paid-team");
    assert.deepEqual(requests[0].payload.byokProviderFlags, [
      { provider: "openai", enabled: true },
    ]);
    assert.equal(requests[0].signal.aborted, false);
  } finally {
    await act(async () => reactRoot.unmount());
    queryClient.clear();
    axios.get = originalAxiosGet;
    dom.window.close();
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});
