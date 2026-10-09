const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const axios = require("axios");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  jsx: true,
  alias: { "@": path.join(root, "src") },
});
const originalCache = new Map(Object.entries(require.cache));
const currentProjectAtom = {};
const currentUserAtom = {};
let project = null;
let boardBilling = null;
let lunaFree = true;
let preferences = {};
let teams = [{ id: "team-free" }];
let lastTeamId = null;
const fullTeams = {
  "team-free": { id: "team-free", subscriptionPlan: [] },
  "team-other": { id: "team-other", subscriptionPlan: [] },
};
const writes = [];
const stub = (relativePath, exports) => {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
stub("src/lib/state.tsx", {
  useRecoilValue: (atom) => atom === currentProjectAtom ? project : { id: 42 },
  useSetRecoilState: () => () => {},
});
stub("src/store/index.ts", { currentProjectAtom, currentUserAtom, selectedSettingsTeamIdAtom: {} });
stub("src/hooks/General/useCurrentBoardBilling.ts", {
  useCurrentBoardBilling: () => boardBilling,
});
stub("src/hooks/MultiPages/useGetAllTeamsMinimal.ts", {
  useGetAllTeamsMinimal: () => ({ data: teams }),
});
stub("src/lib/lastBoardTeam.ts", { getLastBoardTeam: () => lastTeamId });
stub("src/hooks/useFlag.tsx", { useFlag: (key) => key === "htpr-6722-latest-models" && lunaFree });
stub("src/hooks/General/useGetUserPreferences.tsx", {
  USER_PREFERENCES_QUERY_KEY: ["preferences"],
  useGetUserPreferences: () => ({ data: { aiModelPreferences: preferences } }),
});
stub("src/hooks/useTeamAiProviders.ts", {
  useTeamAiProviders: () => ({ enabledProviders: ["openai", "google", "deepseek"], isLoading: false }),
});
stub("src/hooks/useTeamCustomEndpoint.ts", {
  useTeamCustomEndpoint: () => ({ configured: false, isLoading: false }),
});
stub("src/lib/demo/isGuestClient.ts", { isGuestCookieUser: () => false });
const navigationPath = require.resolve("next/navigation");
require.cache[navigationPath] = {
  id: navigationPath, filename: navigationPath, loaded: true,
  exports: { useRouter: () => ({ push: () => {} }) },
};
const { default: ModelSelectorDropdown } = jiti(
  path.join(root, "src/components/Global/ModelSelectorDropdown.tsx"),
);
const { useAiChatModelPreference } = jiti(
  path.join(root, "src/hooks/MultiPages/AIChat/useAiChatModelPreference.ts"),
);
const { aiModelOptions, getAiModelOptionById } = jiti(
  path.join(root, "src/lib/aiModelOptions.ts"),
);
// The pre-fix chat called this hook without a team or billing override.
const { useAiModelPreference } = jiti(
  path.join(root, "src/hooks/General/useAiModelPreference.ts"),
);
for (const filename of Object.keys(require.cache)) {
  if (!originalCache.has(filename)) delete require.cache[filename];
}
for (const [filename, cachedModule] of originalCache) {
  require.cache[filename] = cachedModule;
}

async function withChat(run) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://app.hypertask.ai/chat",
  });
  const previous = {
    React: global.React,
    window: global.window,
    document: global.document,
    IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT,
  };
  Object.assign(global, {
    React,
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const originalGet = axios.get;
  const originalPost = axios.post;
  axios.get = async (url, { params }) => ({
    data: url === "/api/teams/getTeam" ? fullTeams[params.teamId] : {},
  });
  axios.post = async (url, body) => {
    writes.push({ url, body });
    return { status: 200, data: {} };
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const reactRoot = createRoot(dom.window.document.getElementById("root"));
  let result;
  let beforeFix;
  function Harness() {
    result = useAiChatModelPreference();
    beforeFix = useAiModelPreference("aiChat");
    return React.createElement(ModelSelectorDropdown, {
      aiSelected: result.currentAiOption,
      optionCallback: result.setAiOption,
      currentOptions: aiModelOptions,
      modelTeamId: result.modelTeamId,
      modelBilling: result.modelBilling,
    });
  }
  try {
    await act(async () => {
      reactRoot.render(React.createElement(QueryClientProvider, { client },
        React.createElement(Harness)));
    });
    // React Query batches asynchronous query results onto its notification timer.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await run(() => result, () => beforeFix);
  } finally {
    await act(async () => reactRoot.unmount());
    client.clear();
    axios.get = originalGet;
    axios.post = originalPost;
    Object.assign(global, previous);
    dom.window.close();
  }
}

test.beforeEach(() => {
  project = null;
  boardBilling = null;
  lunaFree = true;
  preferences = {};
  teams = [{ id: "team-free" }];
  lastTeamId = null;
  writes.length = 0;
});

test("boardless Free chat defaults to Luna with the flag on", async () => {
  await withChat((read, readBeforeFix) => {
    assert.equal(readBeforeFix().currentAiOption.modelKey, "gemini-3.5-flash-lite");
    assert.equal(read().currentAiOption.modelKey, "gpt-6-luna");
    assert.equal(read().modelTeamId, "team-free");
    assert.equal(read().modelBilling.storePlanId, "Free");
    assert.match(document.querySelector("button").textContent, /6 Luna/);
    assert.equal(writes.length, 0);
  });
});

test("boardless Free chat keeps Gemini with the flag off", async () => {
  lunaFree = false;
  await withChat((read) => {
    assert.equal(read().currentAiOption.modelKey, "gemini-3.5-flash-lite");
    assert.match(document.querySelector("button").textContent, /Gemini 3.5 Flash Lite/);
  });
});

test("boardless chat honours the saved team choice before global and plan defaults", async () => {
  const saved = aiModelOptions.find((option) => option.modelKey === "deepseek-v4-pro");
  assert.ok(saved);
  preferences = {
    aiChat: aiModelOptions.find((option) => option.modelKey === "gemini-3.5-flash-lite").id,
    teams: { "team-free": { aiChat: saved.id } },
  };
  await withChat((read) => {
    assert.equal(read().currentAiOption.id, saved.id);
    assert.match(document.querySelector("button").textContent, /DeepSeek V4 Pro/);
    assert.equal(writes.length, 0);
  });
});

test("boardless chat uses the remembered accessible team and persists its choice", async () => {
  teams = [{ id: "team-other" }, { id: "team-free" }];
  lastTeamId = "team-free";
  await withChat(async (read) => {
    assert.equal(read().modelTeamId, "team-free");
    const choice = getAiModelOptionById(read().currentAiOption.id);
    await act(async () => read().setAiOption(choice));
    assert.equal(writes[0].body.aiModelPreferencesTeamId, "team-free");
    assert.deepEqual(writes[0].body.aiModelPreferences, { aiChat: choice.id });
  });
});

test("an inaccessible remembered team falls back to an available team", async () => {
  lastTeamId = "removed-team";
  await withChat((read) => assert.equal(read().modelTeamId, "team-free"));
});

test("a current board keeps its team and billing", async () => {
  project = { id: 15, teamId: "board-team" };
  boardBilling = { projectId: 15, teamId: "board-team", storePlanId: "Pro" };
  await withChat((read) => {
    assert.equal(read().modelTeamId, "board-team");
    assert.equal(read().modelBilling, boardBilling);
  });
});

test("boardless chat preserves an explicit global choice without a team override", async () => {
  const saved = aiModelOptions.find((option) => option.modelKey === "deepseek-v4-pro");
  preferences = { aiChat: saved.id };
  await withChat((read) => assert.equal(read().currentAiOption.id, saved.id));
});

test("boardless chat waits for a real team instead of assuming a Free plan", async () => {
  teams = [];
  await withChat((read) => {
    assert.equal(read().modelTeamId, null);
    assert.equal(read().modelBilling, null);
    assert.equal(read().currentAiOption.modelKey, "gemini-3.5-flash-lite");
    assert.equal(writes.length, 0);
  });
});
