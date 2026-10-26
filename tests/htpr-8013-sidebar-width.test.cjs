const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const ts = require("typescript");
require("tsx/cjs");
let state = require("../src/lib/state.tsx");
let atoms = require("../src/store/index.ts");
const config = require("../src/lib/configs/style.config.ts");
const { useStore } = require("jotai");

function handle(enabled) {
  const source = fs.readFileSync(path.join(__dirname, "../src/components/AI_CHAT/AiChatSidebarResizeHandle.tsx"), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const dependencies = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "@/lib/state": state,
    "@/store": atoms,
    "@/lib/configs/style.config": config,
    "@/utils/undoActions/helperFuncs": { cn: (...parts) => parts.filter(Boolean).join(" ") },
    "@/hooks/useFlag": { useFlag: () => enabled },
    "@/lib/flags/definitions/htpr-8013-sidebar-width": { HTPR_8013_SIDEBAR_WIDTH_FLAG: "htpr-8013-sidebar-width" },
  };
  const exports = {};
  new Function("require", "exports", js)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports);
  return exports.AiChatSidebarResizeHandle;
}

async function fixture(t, enabled = true) {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://app.hypertask.ai" });
  const previous = { window: global.window, document: global.document, IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  window.innerWidth = 1440;
  delete require.cache[require.resolve("../src/lib/state.tsx")];
  delete require.cache[require.resolve("../src/store/index.ts")];
  state = require("../src/lib/state.tsx");
  atoms = require("../src/store/index.ts");
  let root = createRoot(document.getElementById("root"));
  let store;
  let Handle = handle(enabled);
  function App({ show = true }) {
    store = useStore();
    return show ? React.createElement(Handle) : null;
  }
  const render = async (show = true) => React.act(async () => {
    root.render(React.createElement(state.StateRoot, null, React.createElement(App, { show })));
  });
  await render(false);
  await React.act(async () => store.set(atoms.currentUserAtom, { id: 985 }));
  await render();
  t.after(async () => {
    await React.act(async () => root.unmount());
    dom.window.close();
    Object.assign(global, previous);
  });
  return {
    store, render,
    width: () => Number(document.querySelector('[role="separator"]').getAttribute("aria-valuenow")),
    resize: async (width) => React.act(async () => { window.innerWidth = width; window.dispatchEvent(new window.Event("resize")); }),
    drag: async (delta) => {
      await React.act(async () => document.querySelector('[role="separator"]').dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, clientX: 1000 })));
      await React.act(async () => document.dispatchEvent(new window.MouseEvent("pointermove", { bubbles: true, clientX: 1000 - delta })));
      await React.act(async () => document.dispatchEvent(new window.MouseEvent("pointerup", { bubbles: true })));
    },
    reload: async () => {
      window.dispatchEvent(new window.Event("pagehide"));
      const saved = JSON.parse(localStorageValue());
      await React.act(async () => root.unmount());
      delete require.cache[require.resolve("../src/lib/state.tsx")];
      delete require.cache[require.resolve("../src/store/index.ts")];
      state = require("../src/lib/state.tsx");
      atoms = require("../src/store/index.ts");
      Handle = handle(enabled);
      root = createRoot(document.getElementById("root"));
      await render(false);
      await React.act(async () => store.set(atoms.currentUserAtom, { id: 985 }));
      await render();
      return saved;
    },
    user: async (id) => React.act(async () => store.set(atoms.currentUserAtom, { id })),
  };
}
const localStorageValue = () => window.localStorage.getItem("recoil-persist") || "{}";

test("drag preference survives narrow windows, remounts, reloads and account switches", async (t) => {
  const app = await fixture(t);
  assert.equal(app.width(), 420);
  await app.drag(400);
  assert.equal(app.width(), 820);
  await app.resize(800);
  assert.equal(app.width(), 680);
  await app.render(false);
  await app.render();
  assert.equal(app.width(), 680);
  await app.resize(1440);
  assert.equal(app.width(), 820, "a temporary narrow window must not replace the dragged width");
  await app.drag(-460);
  assert.equal(app.width(), 360);
  const saved = await app.reload();
  assert.equal(saved.aiChatSidebarPreferredWidths[985], 360);
  assert.equal(app.width(), 360);
  await app.user(2343);
  assert.equal(app.width(), 420, "another account starts with the unchanged default");
  await app.drag(100);
  assert.equal(app.width(), 520);
  await app.user(985);
  assert.equal(app.width(), 360);
  await app.resize(390);
  assert.equal(app.width(), 340);
  await app.resize(1440);
  assert.equal(app.width(), 360);
});

test("flag off retains existing width clamping and does not save a per-account preference", async (t) => {
  const app = await fixture(t, false);
  await app.drag(400);
  assert.equal(app.width(), 820);
  await app.resize(800);
  assert.equal(app.width(), 680);
  await app.resize(1440);
  assert.equal(app.width(), 680);
  assert.equal(app.store.get(atoms.aiChatSidebarPreferredWidthsAtom), null);
});

test("first enable preserves the previous browser-wide width until the next drag", async (t) => {
  const app = await fixture(t, false);
  await app.drag(180);
  assert.equal(app.width(), 600);
  const Enabled = handle(true);
  await app.render(false);
  const node = document.getElementById("root");
  const container = document.createElement("div");
  node.appendChild(container);
  const root = createRoot(container);
  try {
    await React.act(async () => root.render(React.createElement(state.StateRoot, {
      initialValues: [[atoms.currentUserAtom, { id: 985 }], [atoms.aiChatSidebarWidthPxAtom, 600]],
    }, React.createElement(Enabled))));
    assert.equal(Number(node.querySelector('[role="separator"]').getAttribute("aria-valuenow")), 600);
    window.dispatchEvent(new window.Event("pagehide"));
    assert.equal(JSON.parse(localStorageValue()).aiChatSidebarPreferredWidths, undefined);
  } finally {
    await React.act(async () => root.unmount());
  }
});

test("an untouched default keeps existing viewport clamping", async (t) => {
  const app = await fixture(t);
  assert.equal(app.width(), 420);
  assert.equal(app.store.get(atoms.aiChatSidebarPreferredWidthsAtom), null);
  await app.resize(390);
  assert.equal(app.width(), 340);
  await app.resize(1440);
  assert.equal(app.width(), 340);
  await app.drag(80);
  assert.equal(app.width(), 420);
  await app.resize(390);
  assert.equal(app.width(), 340);
  await app.resize(1440);
  assert.equal(app.width(), 420, "a deliberate drag to the default width is remembered");
});
