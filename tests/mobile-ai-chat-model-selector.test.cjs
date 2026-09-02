const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  jsx: true,
  alias: { "@": path.join(root, "src") },
});
const originalCache = new Map(Object.entries(require.cache));
let billing = { teamId: "team-1", storePlanId: "Pro", byokProviderFlags: [] };
let enabledProviders = [
  "openai",
  "anthropic",
  "deepseek",
  "moonshot",
  "alibaba",
  "zhipu",
  "google",
  "xai",
];
const pushedRoutes = [];

const stubModule = (filename, exports) => {
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
};
const stubSourceModule = (relativePath, exports) =>
  stubModule(path.join(root, relativePath), exports);

stubSourceModule("src/hooks/General/useCurrentBoardBilling.ts", {
  useCurrentBoardBilling: () => billing,
});
stubSourceModule("src/hooks/useTeamAiProviders.ts", {
  useTeamAiProviders: () => ({
    enabledProviders,
    isLoading: false,
  }),
});
stubSourceModule("src/hooks/useTeamCustomEndpoint.ts", {
  useTeamCustomEndpoint: () => ({
    configured: false,
    isLoading: false,
    modelId: null,
  }),
});
stubSourceModule("src/lib/state.tsx", {
  useRecoilValue: () => ({ teamId: "team-1" }),
  useSetRecoilState: () => () => {},
});
stubSourceModule("src/store/index.ts", {
  currentProjectAtom: {},
  selectedSettingsTeamIdAtom: {},
});
stubSourceModule("src/lib/demo/isGuestClient.ts", {
  isGuestCookieUser: () => false,
});
stubModule(require.resolve("next/navigation"), {
  useRouter: () => ({ push: (route) => pushedRoutes.push(route) }),
});
stubModule(require.resolve("next/link"), {
  default: ({ children, ...props }) => React.createElement("a", props, children),
});

const { default: ModelSelectorDropdown } = jiti(
  path.join(root, "src/components/Global/ModelSelectorDropdown.tsx"),
);
const {
  aiModelOptions,
  getAiModelOptionById,
  getMobileAiChatModelLabel,
  MOBILE_AI_CHAT_QUICK_MODEL_IDS,
} = jiti(path.join(root, "src/lib/aiModelOptions.ts"));

for (const filename of Object.keys(require.cache)) {
  if (!originalCache.has(filename)) delete require.cache[filename];
}
for (const [filename, cachedModule] of originalCache) {
  require.cache[filename] = cachedModule;
}

const selectedOption = (id) => {
  const option = getAiModelOptionById(id);
  assert.ok(option, `missing model option ${id}`);
  return option;
};

test("mobile model gauge offers the four approved choices and preserves guarded selection", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://app.hypertask.ai/project",
  });
  const previousWindow = global.window;
  const previousDocument = global.document;
  const previousNavigator = global.navigator;
  const previousReact = global.React;
  const previousActEnvironment = global.IS_REACT_ACT_ENVIRONMENT;
  global.window = dom.window;
  global.document = dom.window.document;
  global.navigator = dom.window.navigator;
  global.React = React;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.requestAnimationFrame = (callback) =>
    dom.window.setTimeout(() => callback(Date.now()), 0);
  dom.window.cancelAnimationFrame = (id) => dom.window.clearTimeout(id);

  const container = document.getElementById("root");
  const reactRoot = createRoot(container);
  let chosen = null;
  const renderPicker = (aiSelected) =>
    React.createElement(ModelSelectorDropdown, {
      aiSelected,
      currentOptions: aiModelOptions,
      mobileQuickPicker: true,
      optionCallback: (option) => {
        chosen = option;
      },
    });

  try {
    billing = { teamId: "team-1", storePlanId: "Pro", byokProviderFlags: [] };
    enabledProviders = [
      "openai",
      "anthropic",
      "deepseek",
      "moonshot",
      "alibaba",
      "zhipu",
      "google",
      "xai",
    ];
    pushedRoutes.length = 0;
    const lunaHigh = selectedOption("gpt-5.6-luna-high");
    await act(async () => reactRoot.render(renderPicker(lunaHigh)));

    const trigger = container.querySelector('[aria-controls="mobile-ai-chat-model-menu"]');
    assert.ok(trigger);
    assert.match(trigger.className, /h-11 w-11/);
    assert.match(trigger.className, /rounded-\[4px\]/);
    assert.match(trigger.getAttribute("aria-label"), /5\.6 Luna · High/);
    Object.defineProperty(dom.window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    trigger.parentElement.getBoundingClientRect = () => ({ left: 300 });

    await act(async () => trigger.click());
    await act(async () => new Promise((resolve) => dom.window.setTimeout(resolve, 0)));
    const menu = container.querySelector('[role="menu"]');
    assert.ok(menu);
    assert.match(menu.textContent, /Model/i);
    assert.match(menu.className, /right-0/);
    assert.doesNotMatch(menu.className, /\bborder/);
    const rows = [...menu.querySelectorAll('[role="menuitemradio"]')];
    assert.equal(rows.length, 4);
    assert.deepEqual(
      rows.map((row) => row.textContent.trim()),
      MOBILE_AI_CHAT_QUICK_MODEL_IDS.map((id) =>
        getMobileAiChatModelLabel(selectedOption(id)),
      ),
    );
    assert.ok(rows.every((row) => /min-h-11/.test(row.className)));
    assert.ok(rows.every((row) => /rounded-\[4px\]/.test(row.className)));
    assert.equal(rows.filter((row) => row.getAttribute("aria-checked") === "true").length, 1);
    assert.equal(rows[0].getAttribute("aria-checked"), "true");

    await act(async () => rows[1].click());
    await act(async () => new Promise((resolve) => dom.window.setTimeout(resolve, 0)));
    assert.equal(chosen.id, "gpt-5.6-luna");
    assert.equal(container.querySelector('[role="menu"]'), null);
    assert.strictEqual(document.activeElement, trigger);

    await act(async () => trigger.click());
    await act(async () => new Promise((resolve) => dom.window.setTimeout(resolve, 0)));
    const reopenedMenu = container.querySelector('[role="menu"]');
    const reopenedRows = [...reopenedMenu.querySelectorAll('[role="menuitemradio"]')];
    reopenedRows[0].focus();
    reopenedRows[0].dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    assert.strictEqual(document.activeElement, reopenedRows[1]);
    await act(async () =>
      document.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
        }),
      ),
    );
    assert.equal(container.querySelector('[role="menu"]'), null);
    assert.strictEqual(document.activeElement, trigger);

    const claude = selectedOption("claude-sonnet-5-thinking");
    await act(async () => reactRoot.render(renderPicker(claude)));
    assert.equal(getMobileAiChatModelLabel(claude), "Sonnet 5 · Thinking");
    await act(async () => trigger.click());
    assert.equal(
      [...container.querySelectorAll('[role="menuitemradio"]')].filter(
        (row) => row.getAttribute("aria-checked") === "true",
      ).length,
      0,
      "an out-of-set saved model must not show a false active check",
    );
    await act(async () =>
      document.body.dispatchEvent(
        new dom.window.MouseEvent("mousedown", { bubbles: true }),
      ),
    );
    assert.equal(container.querySelector('[role="menu"]'), null);

    enabledProviders = [];
    chosen = null;
    await act(async () => reactRoot.render(renderPicker(lunaHigh)));
    await act(async () => trigger.click());
    const unavailableRows = [
      ...container.querySelectorAll('[role="menuitemradio"]'),
    ];
    assert.equal(unavailableRows.length, 4);
    assert.ok(unavailableRows.every((row) => row.disabled));
    unavailableRows[0].click();
    assert.equal(chosen, null);
    await act(async () =>
      document.body.dispatchEvent(
        new dom.window.MouseEvent("mousedown", { bubbles: true }),
      ),
    );

    enabledProviders = ["openai"];
    billing = { teamId: "team-1", storePlanId: "Free", byokProviderFlags: [] };
    pushedRoutes.length = 0;
    await act(async () => reactRoot.render(renderPicker(lunaHigh)));
    await act(async () => trigger.click());
    const freeRows = [...container.querySelectorAll('[role="menuitemradio"]')];
    assert.equal(freeRows[2].disabled, false);
    await act(async () => freeRows[2].click());
    assert.equal(chosen, null, "a locked premium row must not select a model");
    assert.equal(pushedRoutes.length, 1, "a locked premium row opens plan settings");
  } finally {
    await act(async () => reactRoot.unmount());
    dom.window.close();
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
    if (previousNavigator === undefined) delete global.navigator;
    else global.navigator = previousNavigator;
    if (previousReact === undefined) delete global.React;
    else global.React = previousReact;
    if (previousActEnvironment === undefined) {
      delete global.IS_REACT_ACT_ENVIRONMENT;
    } else {
      global.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  }
});
