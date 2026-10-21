const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { createRoot } = require("react-dom/client");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const modulePath = (relativePath) => path.join(root, relativePath);
const FIX_FLAG = "htpr-7267-shortcut-tips-setting";

const quickTipsAtom = {};
const shortcutTipsAtom = {};
const nudgeAtom = {};
let scenario;

async function renderPendingTip(nextScenario) {
  scenario = { ...nextScenario, writes: [] };
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: "https://app.hypertask.ai/detail/project-15/7267",
  });
  const globalNames = ["document", "IS_REACT_ACT_ENVIRONMENT", "navigator", "React", "window"];
  const previousGlobals = new Map(
    globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]),
  );
  const stubs = new Map();
  const stubModule = (filename, exports) => {
    stubs.set(filename, require.cache[filename]);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  };

  Object.defineProperties(global, {
    document: { configurable: true, value: dom.window.document },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
    navigator: { configurable: true, value: dom.window.navigator },
    React: { configurable: true, value: React },
    window: { configurable: true, value: dom.window },
  });

  stubModule(require.resolve("next/navigation"), {
    usePathname: () => "/detail/project-15/7267",
  });
  stubModule(require.resolve("lucide-react"), {
    X: () => React.createElement("span", null, "close"),
  });
  stubModule(modulePath("src/hooks/useFlag.tsx"), {
    useFlag: (key) => (key === FIX_FLAG ? scenario.fixFlagOn : true),
  });
  stubModule(modulePath("src/store/index.ts"), {
    archiveShortcutNudgeAtom: nudgeAtom,
    currentUserAtom: {},
    showQuickTipsAtom: quickTipsAtom,
    shortcutTipsEnabledAtom: shortcutTipsAtom,
  });
  const recordingState = (name, initial) => {
    const [value, setValue] = React.useState(initial);
    return [value, (next) => { scenario.writes.push([name, next]); setValue(next); }];
  };
  stubModule(modulePath("src/lib/state.tsx"), {
    useRecoilValue: () => ({ id: 6 }),
    useRecoilState: (atom) => {
      if (atom === quickTipsAtom) return recordingState("quickTipsBar", scenario.quickTipsBarShown);
      if (atom === shortcutTipsAtom) return recordingState("shortcutTips", scenario.shortcutTipsEnabled);
      return React.useState({ accountId: 6, hideAt: null, mouseArchives: 0, stage: "pending" });
    },
  });

  let reactRoot;
  try {
    const jiti = createJiti(__filename, {
      alias: { "@": path.join(root, "src") },
      interopDefault: true,
      jsx: true,
    });
    const ShortcutArchiveNudge = jiti(modulePath("src/components/Global/ShortcutArchiveNudge.tsx")).default;
    reactRoot = createRoot(document.getElementById("root"));
    await React.act(async () => {
      reactRoot.render(React.createElement(ShortcutArchiveNudge));
      await new Promise((resolve) => setImmediate(resolve));
    });
    const shown = /Tip: press E to archive/.test(document.body.textContent);
    if (shown) {
      const turnOff = [...document.querySelectorAll("button")].find((b) => b.textContent === "Turn off all tips");
      await React.act(async () => turnOff.click());
    }
    return { shown, writes: scenario.writes };
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    for (const [filename, previous] of stubs) {
      if (previous === undefined) delete require.cache[filename];
      else require.cache[filename] = previous;
    }
    for (const [name, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
    dom.window.close();
  }
}

test("the tip shows after a closed quick-tips bar, and Turn off all tips switches off both", async () => {
  const result = await renderPendingTip({ fixFlagOn: true, quickTipsBarShown: false, shortcutTipsEnabled: true });
  assert.equal(result.shown, true);
  assert.deepEqual(result.writes, [["shortcutTips", false], ["quickTipsBar", false]]);
});

test("the tip stays hidden once the user turned shortcut tips off", async () => {
  const result = await renderPendingTip({ fixFlagOn: true, quickTipsBarShown: true, shortcutTipsEnabled: false });
  assert.equal(result.shown, false);
});

test("with the fix flag off a closed quick-tips bar still hides the tip", async () => {
  const result = await renderPendingTip({ fixFlagOn: false, quickTipsBarShown: false, shortcutTipsEnabled: true });
  assert.equal(result.shown, false);
});
