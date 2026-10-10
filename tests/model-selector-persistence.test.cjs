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
const providers = ["openai", "anthropic", "google", "deepseek"];
let enabledProviders = providers;
let providersLoading = false;
let endpointLoading = false;
let hydrated = true;
const stub = (filename, exports) => {
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
const stubSource = (file, exports) => stub(path.join(root, file), exports);
stubSource("src/lib/state.tsx", {
  useRecoilValue: () => ({ teamId: "fixture-team" }),
  useSetRecoilState: () => () => {},
});
stubSource("src/store/index.ts", { currentProjectAtom: {}, selectedSettingsTeamIdAtom: {} });
stubSource("src/hooks/General/useCurrentBoardBilling.ts", {
  useCurrentBoardBilling: () => ({ teamId: "fixture-team", storePlanId: "Free" }),
});
stubSource("src/hooks/General/useGetUserPreferences.tsx", {
  USER_PREFERENCES_QUERY_KEY: ["preferences"],
  useGetUserPreferences: () => ({ data: { aiModelPreferences: { aiChat: "claude-haiku-5-5" } } }),
});
stubSource("src/hooks/useTeamAiProviders.ts", {
  useTeamAiProviders: () => ({ enabledProviders, isLoading: providersLoading }),
});
stubSource("src/hooks/useTeamCustomEndpoint.ts", {
  useTeamCustomEndpoint: () => ({ configured: false, isLoading: endpointLoading }),
});
stubSource("src/hooks/General/useHydrated.ts", { useHydrated: () => hydrated });
stubSource("src/lib/realtime/client.ts", {
  connectRealtimeClient: async () => null,
  releaseRealtimeClientIfIdle: () => {},
});
stubSource("src/lib/demo/isGuestClient.ts", { isGuestCookieUser: () => false });
stub(require.resolve("next/navigation"), { useRouter: () => ({ push: () => {} }) });
const { default: ModelSelectorDropdown } = jiti(path.join(root, "src/components/Global/ModelSelectorDropdown.tsx"));
const { useAiModelPreference } = jiti(path.join(root, "src/hooks/General/useAiModelPreference.ts"));
const { FeatureFlagProvider, featureFlagsQueryKey } = jiti(path.join(root, "src/hooks/useFlag.tsx"));
const { aiModelOptions, getAiModelOptionById } = jiti(path.join(root, "src/lib/aiModelOptions.ts"));
for (const filename of Object.keys(require.cache)) {
  if (!originalCache.has(filename)) delete require.cache[filename];
}
for (const [filename, cached] of originalCache) require.cache[filename] = cached;

const flagValues = (haiku) => ({
  "htpr-7010-haiku-5-5": haiku,
  "htpr-7038-haiku-default": haiku,
  "htpr-6722-latest-models": false,
});

async function withPicker(run, { preferenceHook = false, initialFlags, mobile = false } = {}) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://fixture.invalid/chat" });
  const previous = {
    React: global.React, window: global.window, document: global.document,
    IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT, fetch: global.fetch,
  };
  Object.assign(global, {
    React, window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async () => new Promise(() => {}),
  });
  const originalGet = axios.get;
  const originalPost = axios.post;
  const writes = [];
  axios.get = async () => ({ data: {} });
  axios.post = async (_url, body) => { writes.push(body); return { status: 200, data: {} }; };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const reactRoot = createRoot(document.getElementById("root"));
  const chosen = [];
  function PreferencePicker() {
    const preference = useAiModelPreference("aiChat");
    return React.createElement(ModelSelectorDropdown, {
      aiSelected: preference.currentAiOption,
      optionCallback: preference.setAiOption,
      currentOptions: aiModelOptions,
    });
  }
  const render = () => reactRoot.render(React.createElement(QueryClientProvider, { client },
    React.createElement(FeatureFlagProvider, { userId: 42, initialFlags },
      preferenceHook ? React.createElement(PreferencePicker) : React.createElement(ModelSelectorDropdown, {
        aiSelected: getAiModelOptionById("claude-haiku-5-5", true),
        currentOptions: aiModelOptions,
        mobileQuickPicker: mobile,
        optionCallback: (option) => chosen.push(option.id),
      }))));
  const update = async (values) => {
    await act(async () => {
      if (values) client.setQueryData(featureFlagsQueryKey(42), values);
      render();
    });
  };
  try {
    await update();
    await run({ chosen, writes, update, client, container: document.getElementById("root") });
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
  enabledProviders = providers;
  providersLoading = false;
  endpointLoading = false;
  hydrated = true;
});

for (const mobile of [false, true]) {
  test(`saved Haiku is not persisted as a fallback before flags load (${mobile ? "mobile" : "desktop"})`, async () => {
    await withPicker(async ({ chosen, update }) => {
      assert.deepEqual(chosen, [], "initial unavailable display must not save a fallback");
      await update(flagValues(true));
      assert.deepEqual(chosen, [], "loaded available Haiku must preserve the saved choice");
    }, { mobile });
  });
}

test("the composer preference hook never posts a team override during flag initialization", async () => {
  await withPicker(async ({ writes, update }) => {
    assert.deepEqual(writes, [], "initial load must not write teams.fixture-team.aiChat");
    await update(flagValues(true));
    assert.deepEqual(writes, [], "flag resolution must not persist the old computed selection");
  }, { preferenceHook: true });
});

test("loaded Off flags still persist a genuinely unavailable model fallback", async () => {
  await withPicker(async ({ chosen, update }) => {
    await update(flagValues(false));
    assert.deepEqual(chosen, ["gemini-3.5-flash-lite"]);
  });
});

test("missing model flags and failed flag fetches are not proof of unavailability", async () => {
  await withPicker(async ({ chosen, update, client }) => {
    await update({ "htpr-6722-latest-models": false });
    assert.deepEqual(chosen, []);
    await act(async () => {
      client.getQueryCache().find({ queryKey: featureFlagsQueryKey(42) }).setState({ status: "error", error: new Error("fixture flag failure") });
    });
    await update();
    assert.deepEqual(chosen, []);
  });
});

test("flags fetched before hydration cannot cause an automatic save", async () => {
  hydrated = false;
  await withPicker(async ({ chosen, update }) => {
    await update(flagValues(true));
    assert.deepEqual(chosen, []);
    hydrated = true;
    await update();
    assert.deepEqual(chosen, []);
  });
});

test("provider and endpoint loading retain their existing fallback guards", async () => {
  providersLoading = true;
  endpointLoading = true;
  enabledProviders = ["google"];
  await withPicker(async ({ chosen, update }) => {
    await update(flagValues(true));
    assert.deepEqual(chosen, []);
    providersLoading = false;
    await update();
    assert.deepEqual(chosen, []);
    endpointLoading = false;
    await update();
    assert.deepEqual(chosen, ["gemini-3.5-flash-lite"]);
  });
});

test("explicit user selection still saves while model flags are unresolved", async () => {
  await withPicker(async ({ chosen, container }) => {
    await act(async () => container.querySelector("button").click());
    const modelMenu = [...container.querySelectorAll("button")].find((button) => button.textContent.startsWith("Model"));
    assert.ok(modelMenu);
    await act(async () => modelMenu.click());
    const option = [...container.querySelectorAll("button")].find((button) => button.textContent.includes("DeepSeek V4 Pro"));
    assert.ok(option);
    await act(async () => option.click());
    assert.equal(chosen.length, 1);
    assert.equal(chosen[0], "deepseek-v4-pro");
  });
});
