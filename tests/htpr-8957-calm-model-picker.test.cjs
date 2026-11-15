const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { loadModule } = require("./helpers/loadModule.cjs");

const FLAG = "htpr-8957-calm-model-picker";
const AUTO_FLAG = "htpr-7915-auto-model";

test("calm rows stay flat, keep provider and price, and drop descriptions", () => {
  const { calmModelRows } = loadModule("src/lib/aiChat/calmModelPicker.ts");
  const rows = calmModelRows(
    [
      { key: "openai", label: "OpenAI" },
      { key: "anthropic", label: "Anthropic" },
    ],
    [
      { key: "opus", label: "Opus 5.5", provider: "anthropic", priceTier: 3, description: "Deep reasoning" },
      { key: "luna", label: "Luna 6", provider: "openai", priceTier: 2, description: "Cheap and fast" },
    ],
  );
  assert.deepEqual(rows, [
    { key: "luna", label: "Luna 6", providerLabel: "OpenAI", price: "$$" },
    { key: "opus", label: "Opus 5.5", providerLabel: "Anthropic", price: "$$$" },
  ]);
  assert.equal(JSON.stringify(rows).includes("Cheap and fast"), false);
  assert.equal(JSON.stringify(rows).includes("Deep reasoning"), false);
});

async function mount(enabled) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://app.hypertask.ai/project" });
  const previousWindow = global.window;
  const previousDocument = global.document;
  const previousNavigator = global.navigator;
  const previousAct = global.IS_REACT_ACT_ENVIRONMENT;
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(global, "navigator", { configurable: true, value: dom.window.navigator });
  dom.window.requestAnimationFrame = (callback) => dom.window.setTimeout(() => callback(Date.now()), 0);
  dom.window.cancelAnimationFrame = (id) => dom.window.clearTimeout(id);
  const { default: ModelSelectorDropdown } = loadModule("src/components/Global/ModelSelectorDropdown.tsx", {
    react: React,
    "next/navigation": { useRouter: () => ({ push() {} }) },
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "@/hooks/useFlag": {
      useFlag: (key) => key === FLAG ? enabled : key === AUTO_FLAG,
      useFlagLoaded: () => true,
    },
    "@/hooks/General/useCurrentBoardBilling": {
      useCurrentBoardBilling: () => ({ teamId: "team-1", storePlanId: "Pro", byokProviderFlags: [] }),
    },
    "@/hooks/useTeamAiProviders": {
      useTeamAiProviders: () => ({
        enabledProviders: ["openai", "anthropic", "google", "deepseek", "moonshot", "alibaba", "zhipu", "xai"],
        isLoading: false,
        ownKeyOnly: false,
      }),
    },
    "@/hooks/useTeamCustomEndpoint": {
      useTeamCustomEndpoint: () => ({ configured: false, isLoading: false, modelId: null }),
    },
    "@/hooks/General/useAiModelPreference": {
      useAiModelPreference: () => ({ setAiOption() {} }),
      useAiThinkingPreference: () => ({
        preference: { enabled: false, effort: "low" },
        setPreference() {},
      }),
    },
    "@/hooks/General/useGetUserPreferences": {
      useGetUserPreferences: () => ({ data: { aiModelPreferences: {} } }),
    },
    "@/lib/state": {
      useRecoilValue: () => ({ teamId: "team-1" }),
      useSetRecoilState: () => () => {},
    },
    "@/store": { currentProjectAtom: {}, selectedSettingsTeamIdAtom: {} },
    "@/lib/demo/isGuestClient": { isGuestCookieUser: () => false },
  });
  const { aiModelOptions, getAiModelOptionById, toAutoModelOption } = loadModule("src/lib/aiModelOptions.ts");
  const selected = getAiModelOptionById("gpt-6-luna");
  assert.ok(selected);
  const container = document.getElementById("root");
  const renderer = createRoot(container);
  await React.act(async () => {
    renderer.render(React.createElement(ModelSelectorDropdown, {
      aiSelected: selected,
      currentOptions: [toAutoModelOption(selected), ...aiModelOptions],
      calm: true,
      optionCallback() {},
    }));
  });
  const cleanup = async () => {
    await React.act(async () => renderer.unmount());
    global.window = previousWindow;
    global.document = previousDocument;
    global.IS_REACT_ACT_ENVIRONMENT = previousAct;
    Object.defineProperty(global, "navigator", { configurable: true, value: previousNavigator });
    dom.window.close();
  };
  return { container, cleanup };
}

test("flag on pins Auto, shows provider and price, and hides the nested menu", async () => {
  const { container, cleanup } = await mount(true);
  try {
    const trigger = container.querySelector("button[aria-expanded='false']");
    assert.ok(trigger);
    await React.act(async () => trigger.click());
    const menu = container.querySelector("[data-calm-model-picker]");
    assert.ok(menu);
    const auto = menu.querySelector("[data-calm-auto]");
    const models = [...menu.querySelectorAll("[data-calm-model]")];
    assert.ok(auto);
    assert.ok(models.length > 1);
    assert.match(auto.textContent, /Auto/);
    assert.ok(auto.compareDocumentPosition(models[0]) & 4);
    assert.match(models[0].textContent, /Luna 6/);
    assert.match(models[0].textContent, /OpenAI/);
    assert.match(models[0].textContent, /\$\$/);
    assert.equal(menu.querySelectorAll(".uppercase").length, 0);
    assert.equal(menu.textContent.includes("Reset to default"), false);
    assert.equal(menu.textContent.includes("Cheap and fast"), false);
    assert.equal(menu.textContent.includes("fastest"), false);
    const standard = menu.querySelector("[data-calm-effort='standard']");
    assert.equal(standard && standard.getAttribute("aria-pressed"), "true");
    assert.match(standard.textContent, /Standard/);
  } finally {
    await cleanup();
  }
});

test("flag off keeps the nested menu and the reset row", async () => {
  const { container, cleanup } = await mount(false);
  try {
    const trigger = container.querySelector("button[aria-expanded='false']");
    assert.ok(trigger);
    await React.act(async () => trigger.click());
    assert.equal(container.querySelector("[data-calm-model-picker]"), null);
    assert.equal(container.textContent.includes("Reset to default"), true);
    assert.match(container.textContent, /Model/);
  } finally {
    await cleanup();
  }
});
