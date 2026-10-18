const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { createRoot } = require("react-dom/client");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
  jsx: true,
});

async function withPhoneBrowser({ visibleWidth, layoutWidth }, run) {
  const dom = new JSDOM(`<div id="root"></div>`, { url: "https://app.hypertask.ai/detail/project-8384/11" });
  const listeners = new Set();
  const screen = { visibleWidth, layoutWidth };
  Object.defineProperty(dom.window, "innerWidth", { configurable: true, get: () => screen.visibleWidth });
  dom.window.matchMedia = (query) => {
    assert.equal(query, "(min-width: 768px)");
    return {
      get matches() { return screen.layoutWidth >= 768; },
      addEventListener: (_type, listener) => listeners.add(listener),
      removeEventListener: (_type, listener) => listeners.delete(listener),
    };
  };
  const resize = async (next) => {
    Object.assign(screen, next);
    await React.act(async () => {
      dom.window.dispatchEvent(new dom.window.Event("resize"));
      for (const listener of [...listeners]) listener();
    });
  };
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(global, key, { value, configurable: true, writable: true });
  }
  try {
    await run(dom.window.document.getElementById("root"), resize);
  } finally {
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  }
}

const flagState = { loaded: true, on: true };
const useFlagFile = path.join(root, "src/hooks/useFlag.tsx");
function loadModules() {
  const previous = require.cache[useFlagFile];
  require.cache[useFlagFile] = {
    id: useFlagFile, filename: useFlagFile, loaded: true,
    exports: { useFlag: () => flagState.loaded && flagState.on, useFlagLoaded: () => flagState.loaded },
  };
  try {
    return {
      ...jiti(path.join(root, "src/lib/contexts/mobileContext.tsx")),
      FlagBridge: jiti(path.join(root, "src/lib/contexts/MobileViewFlagBridge.tsx")).default,
    };
  } finally {
    if (previous) require.cache[useFlagFile] = previous;
    else delete require.cache[useFlagFile];
  }
}

async function renderLayout(screen, { flagOn = true, flagLoaded = true, initialIsMobile = false } = {}, afterRender) {
  Object.assign(flagState, { on: flagOn, loaded: flagLoaded });
  const { default: MobileViewProvider, MobileViewContext, FlagBridge } = loadModules();
  const seen = [];
  function Layout() {
    const isPhone = React.useContext(MobileViewContext);
    seen.push(isPhone);
    return React.createElement("p", null, isPhone ? "phone" : "desktop");
  }
  let text;
  await withPhoneBrowser(screen, async (container, resize) => {
    const reactRoot = createRoot(container);
    await React.act(async () => {
      reactRoot.render(React.createElement(MobileViewProvider, { initialIsMobile },
        React.createElement(FlagBridge), React.createElement(Layout)));
    });
    if (afterRender) await afterRender(resize);
    text = container.textContent;
    await React.act(async () => reactRoot.unmount());
  });
  return { text, seen };
}

test("a phone page zoomed out to 780px still gets the phone layout, so no desktop chat sidebar opens", async () => {
  const { text } = await renderLayout({ visibleWidth: 780, layoutWidth: 390 });
  assert.equal(text, "phone");
});

test("with the bugfix flag off, the zoomed-out phone keeps the old desktop result", async () => {
  const { text } = await renderLayout({ visibleWidth: 780, layoutWidth: 390 }, { flagOn: false });
  assert.equal(text, "desktop");
});

test("while flags are still loading, a zoomed-out phone never flips to the desktop layout", async () => {
  const { seen } = await renderLayout({ visibleWidth: 780, layoutWidth: 390 }, { flagLoaded: false });
  const firstPhoneRender = seen.indexOf(true);
  assert.notEqual(firstPhoneRender, -1);
  assert.deepEqual(seen.slice(firstPhoneRender).filter((isPhone) => !isPhone), []);
});

test("still allowed: a 1440px desktop keeps the desktop layout", async () => {
  const { text } = await renderLayout({ visibleWidth: 1440, layoutWidth: 1440 }, { initialIsMobile: true });
  assert.equal(text, "desktop");
});

test("still allowed: a plain 390px phone keeps the phone layout", async () => {
  const { text } = await renderLayout({ visibleWidth: 390, layoutWidth: 390 });
  assert.equal(text, "phone");
});

test("narrowing a desktop window below 768px switches to the phone layout and back", async () => {
  const states = [];
  await renderLayout({ visibleWidth: 1440, layoutWidth: 1440 }, {}, async (resize) => {
    states.push(document.getElementById("root").textContent);
    await resize({ visibleWidth: 700, layoutWidth: 700 });
    states.push(document.getElementById("root").textContent);
    await resize({ visibleWidth: 1024, layoutWidth: 1024 });
    states.push(document.getElementById("root").textContent);
  });
  assert.deepEqual(states, ["desktop", "phone", "desktop"]);
});
