const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { createRoot } = require("react-dom/client");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const modulePath = (relativePath) => path.join(root, relativePath);

test("the archive shortcut nudge appears on a mobile task page", async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: "https://app.hypertask.ai/detail/project-15/5906",
  });
  const globalNames = [
    "document",
    "IS_REACT_ACT_ENVIRONMENT",
    "navigator",
    "React",
    "window",
  ];
  const previousGlobals = new Map(
    globalNames.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(global, name),
    ]),
  );
  const stubs = new Map();
  const stubModule = (filename, exports) => {
    stubs.set(filename, require.cache[filename]);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  };
  const tipsAtom = {};
  const nudgeAtom = {};

  Object.defineProperties(global, {
    document: { configurable: true, value: dom.window.document },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
    navigator: { configurable: true, value: dom.window.navigator },
    React: { configurable: true, value: React },
    window: { configurable: true, value: dom.window },
  });

  stubModule(require.resolve("next/navigation"), {
    usePathname: () => "/detail/project-15/5906",
  });
  stubModule(require.resolve("lucide-react"), {
    X: () => React.createElement("span", null, "close"),
  });
  stubModule(modulePath("src/hooks/useFlag.tsx"), { useFlag: () => true });
  stubModule(modulePath("src/store/index.ts"), {
    archiveShortcutNudgeAtom: nudgeAtom,
    currentUserAtom: {},
    showQuickTipsAtom: tipsAtom,
  });
  stubModule(modulePath("src/lib/state.tsx"), {
    useRecoilValue: () => ({ id: 6 }),
    useRecoilState: (atom) =>
      atom === tipsAtom
        ? React.useState(true)
        : React.useState({
            accountId: 6,
            hideAt: null,
            mouseArchives: 0,
            stage: "pending",
          }),
  });

  let reactRoot;
  try {
    const jiti = createJiti(__filename, {
      alias: { "@": path.join(root, "src") },
      interopDefault: true,
      jsx: true,
    });
    const ShortcutArchiveNudge = jiti(
      modulePath("src/components/Global/ShortcutArchiveNudge.tsx"),
    ).default;
    const { MobileViewContext } = jiti(
      modulePath("src/lib/contexts/mobileContext.tsx"),
    );

    reactRoot = createRoot(document.getElementById("root"));
    await React.act(async () => {
      reactRoot.render(
        React.createElement(
          MobileViewContext.Provider,
          { value: true },
          React.createElement(ShortcutArchiveNudge),
        ),
      );
      await new Promise((resolve) => setImmediate(resolve));
    });

    assert.match(document.body.textContent, /Tip: press E to archive/);
  } finally {
    if (reactRoot) {
      await React.act(async () => reactRoot.unmount());
    }
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
});
