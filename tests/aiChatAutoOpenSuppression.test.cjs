const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { Provider, createStore } = require("jotai");
const { hydrateRoot } = require("react-dom/client");
const { renderToString } = require("react-dom/server");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const boardPath = "src/app/[...boardURL]/LandingPage.tsx";
const detailPath = "src/app/detail/[...slug]/useTaskDetailModals.tsx";

function load(source, mocks = {}) {
  const loadedModule = { exports: {} };
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  new Function("require", "module", "exports", javascript)(
    (name) => mocks[name] ?? require(name), loadedModule, loadedModule.exports,
  );
  return loadedModule.exports;
}

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

// Run the actual route effects without loading board/network/editor dependencies.
function effectFrom(relative, identifies, extraNames = []) {
  const source = read(relative);
  const ast = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const effects = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
        identifies(node.getText(ast))) effects.push(node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(effects.length, 1, `identify exactly one production effect in ${relative}`);
  return load(`export function run(scope) { const { useEffect, ...values } = scope;
    const { hydrated, slugs, _parsedTask, openAiChatByDefault, aiChatAutoOpenSuppressed,
      aiChatPinned, isMblForChat, _mbl, isGuest, setShowAiChatInterface,
      ${extraNames.join(", ")} } = values;
    ${effects[0]}; }`).run;
}

const headerSource = read("src/hooks/MultiPages/AIChat/aiChatKeyboard.ts");
const headerAst = ts.createSourceFile("aiChatKeyboard.ts", headerSource, ts.ScriptTarget.Latest, true);
let headerDeclaration;
function findHeaderClose(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(headerAst) === "togglePopover")
    headerDeclaration = node.getText(headerAst);
  ts.forEachChild(node, findHeaderClose);
}
findHeaderClose(headerAst);
assert.ok(headerDeclaration, "find the actual header-close handler");
const headerClose = load(`export function close(scope) {
  const { editor, setAiChatAutoOpenSuppressed, setAiChatPinned, setShowAIChat,
    setMinimized, setChatMounted } = scope;
  const ${headerDeclaration}; togglePopover();
}`).close;

function userOpenFrom(relative, identifies, invocation) {
  const ast = ts.createSourceFile(relative, read(relative), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches = [];
  function visit(node) {
    if (identifies(node, ast)) matches.push(node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(matches.length, 1, "identify one actual user-open handler");
  return load(`export function open(scope) {
    const { params, welcomeAiHandledRef, aiChatPinned, setAiChatPinned,
      setAiChatExplicitOpenAt, setShowAiChatInterface, setAiChatAutoOpenSuppressed,
      setIsOverflowOpen } = scope;
    ${invocation(matches[0])}
  }`).open;
}
const welcomeOpen = userOpenFrom(boardPath,
  (node, ast) => ts.isIfStatement(node) && node.expression.getText(ast).includes('params.get("welcome_ai")'),
  (source) => source);
const pinOpen = userOpenFrom("src/components/AI_CHAT/ChatHeader.tsx",
  (node, ast) => ts.isArrowFunction(node) && ts.isBlock(node.body) && node.body.statements.some(
    (statement) => ts.isVariableStatement(statement) && statement.declarationList.declarations.some(
      (declaration) => declaration.name.getText(ast) === "nextPinned")),
  (source) => `(${source})();`);

async function harness(persisted, run) {
  const previous = { window: global.window, document: global.document,
    IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT };
  const dom = new JSDOM("<div id='root'></div>", { url: "https://app.hypertask.ai/project?id=1" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.setItem("recoil-persist", JSON.stringify(persisted));
  window.sessionStorage.setItem("ht:aiChatOpen", "0");
  const hydration = load(read("src/hooks/General/useHydrated.ts"));
  const state = load(read("src/lib/state.tsx"), {
    "@/hooks/General/useHydrated": hydration,
  });
  const storeSource = read("src/store/index.ts");
  const storeAst = ts.createSourceFile("store.ts", storeSource, ts.ScriptTarget.Latest, true);
  const names = new Set(["showAIChatInterfaceAtom", "openAiChatByDefaultAtom",
    "aiChatAutoOpenSuppressedAtom", "aiChatPinnedAtom"]);
  const declarations = storeAst.statements.filter((node) => ts.isVariableStatement(node) &&
    node.declarationList.declarations.some((declaration) => names.has(declaration.name.getText(storeAst))));
  assert.equal(declarations.length, names.size);
  const atoms = load(`import { atom, recoilPersist } from "@/lib/state";
    const { persistAtom } = recoilPersist();
    ${declarations.map((node) => node.getText(storeAst)).join("\n")}`, { "@/lib/state": state });
  const store = createStore();
  const mobileContext = React.createContext(false);
  for (const name of ["showBoardManagerAtom", "showShortcutsAtom", "showCommandsAtom",
    "showSidebarAtom", "showAnnouncementsAtom", "showScrollSettingModalAtom"])
    atoms[name] = state.atom({ key: name, default: false });
  atoms.aiChatExplicitOpenAtAtom = state.atom({ key: "aiChatExplicitOpenAt", default: null });
  const { useUIStateManager } = load(read("src/hooks/General/useUIStateManager.ts"), {
    "@/lib/state": state,
    "@/store": atoms,
    "@/lib/contexts/mobileContext": { MobileViewContext: mobileContext },
    "next/navigation": { usePathname: () => "/project" },
  });
  let reactRoot;
  let ui;
  const attemptedOpens = [];
  const unsubscribe = store.sub(atoms.showAIChatInterfaceAtom, () => {
    if (store.get(atoms.showAIChatInterfaceAtom)) attemptedOpens.push(true);
  });
  function Fixture({ relative, id = 1, mobile = false, guest = false }) {
    ui = useUIStateManager("aiChatInterface");
    const hydrated = hydration.useHydrated();
    const [, setShowAiChatInterface] = state.useRecoilState(atoms.showAIChatInterfaceAtom);
    const openAiChatByDefault = state.useRecoilValue(atoms.openAiChatByDefaultAtom);
    const aiChatAutoOpenSuppressed = state.useRecoilValue(atoms.aiChatAutoOpenSuppressedAtom);
    const aiChatPinned = state.useRecoilValue(atoms.aiChatPinnedAtom);
    const restoreRef = React.useRef(false);
    const effect = effects[relative];
    effect({ useEffect: React.useEffect, hydrated, slugs: String(id), _parsedTask: { id },
      openAiChatByDefault, aiChatAutoOpenSuppressed, aiChatPinned, isMblForChat: mobile,
      _mbl: mobile, isGuest: guest, setShowAiChatInterface,
      hasAttemptedChatRestoreRef: restoreRef, hasAttemptedRestoreRef: restoreRef,
      currentUser: hydrated && !guest ? { id: 123 } : null, pathname: "/my-tasks",
      NO_CHAT_RESTORE_ROUTES: ["/login"], MOBILE_VIEWPORT_MAX_PX: 768,
      readChatOpenForSession: () => window.sessionStorage.getItem("ht:aiChatOpen") === "1",
      openAIChatInterface: ui.open, setChatRuntimeMounted: () => {}, setChatMounted: () => {},
      setShowAIChat: setShowAiChatInterface,
      setAiChatExplicitOpenAt: state.useSetRecoilState(atoms.aiChatExplicitOpenAtAtom),
      shouldMountChatRuntime: false, isFullScreenChat: false,
      isControlQFocusShortcut: (event) => event.ctrlKey && event.key === "q" });
    return React.createElement("p", null, "Workspace");
  }
  const tree = (props) => React.createElement(Provider, { store }, React.createElement(Fixture, props));
  const container = document.getElementById("root");
  async function hydrate(props) {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    container.innerHTML = renderToString(tree(props));
    const errors = [];
    await React.act(async () => {
      reactRoot = hydrateRoot(container, tree(props), { onRecoverableError: (error) => errors.push(error) });
    });
    assert.deepEqual(errors, [], "no hydration mismatch");
  }
  try {
    await run({ store, atoms, state, attemptedOpens, hydrate,
      navigate: (props) => React.act(async () => reactRoot.render(tree(props))),
      headerClose: () => headerClose({ editor: null,
        setAiChatAutoOpenSuppressed: (value) => store.set(atoms.aiChatAutoOpenSuppressedAtom, value),
        setAiChatPinned: (value) => store.set(atoms.aiChatPinnedAtom, value),
        setShowAIChat: (value) => store.set(atoms.showAIChatInterfaceAtom, value),
        setMinimized: () => {}, setChatMounted: () => {} }),
      userOpen: (handler) => handler({ params: new URLSearchParams("welcome_ai=1"),
        welcomeAiHandledRef: { current: false }, aiChatPinned: store.get(atoms.aiChatPinnedAtom),
        setAiChatPinned: (value) => store.set(atoms.aiChatPinnedAtom, value),
        setAiChatExplicitOpenAt: (value) => store.set(atoms.aiChatExplicitOpenAtAtom, value),
        setShowAiChatInterface: (value) => store.set(atoms.showAIChatInterfaceAtom, value),
        setAiChatAutoOpenSuppressed: (value) => store.set(atoms.aiChatAutoOpenSuppressedAtom, value),
        setIsOverflowOpen: () => {} }),
      ui: () => ui });
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    unsubscribe();
    window.dispatchEvent(new window.Event("pagehide"));
    dom.window.close();
    Object.assign(global, previous);
  }
}

const effects = Object.fromEntries([boardPath, detailPath].map((relative) => [relative,
  effectFrom(relative, (source) => source.includes("openAiChatByDefault"))]));
const restorePaths = ["src/components/ProviderGlobal/GloablProviders.tsx",
  "src/hooks/MultiPages/AIChat/useAiChatPresentation.ts"];
for (const relative of restorePaths) {
  effects[relative] = effectFrom(relative, (source) => source.includes("readChatOpenForSession()"),
    ["hasAttemptedChatRestoreRef", "hasAttemptedRestoreRef", "currentUser", "pathname",
      "NO_CHAT_RESTORE_ROUTES", "MOBILE_VIEWPORT_MAX_PX", "readChatOpenForSession",
      "openAIChatInterface", "setChatRuntimeMounted", "setChatMounted", "setShowAIChat",
      "setAiChatExplicitOpenAt"]);
}

effects.ctrlQ = effectFrom(restorePaths[0], (source) => source.includes("openChatFromFocusShortcut"),
  ["shouldMountChatRuntime", "isFullScreenChat", "isControlQFocusShortcut", "setChatRuntimeMounted", "openAIChatInterface"]);

for (const relative of [boardPath, detailPath]) {
  test(`${relative}: saved manual close never opens during hydration or navigation`, async () => {
    await harness({ aiChatAutoOpenSuppressed: true, aiChatPinned: false }, async (h) => {
      await h.hydrate({ relative });
      assert.deepEqual(h.attemptedOpens, [], "SSR defaults must not open chat before saved suppression is visible");
      assert.equal(h.store.get(h.atoms.showAIChatInterfaceAtom), false);
      assert.equal(h.store.get(h.atoms.aiChatAutoOpenSuppressedAtom), true);
      await h.navigate({ relative, id: 2 });
      await h.navigate({ relative: relative === boardPath ? detailPath : boardPath, id: 3 });
      assert.deepEqual(h.attemptedOpens, [], "new route consumers must also wait for hydration");
    });
  });

  for (const method of ["rail", "header"]) {
    test(`${relative}: closing by ${method} survives reload; explicit open restores default auto-open`, async () => {
      await harness({}, async (h) => {
        await h.hydrate({ relative });
        assert.equal(h.store.get(h.atoms.showAIChatInterfaceAtom), true, "fresh default setting opens chat");
        await React.act(async () => method === "rail" ? h.ui().toggle() : h.headerClose());
        assert.equal(h.store.get(h.atoms.aiChatAutoOpenSuppressedAtom), true);
        assert.equal(h.store.get(h.atoms.aiChatPinnedAtom), false);
        window.dispatchEvent(new window.Event("pagehide"));
        assert.equal(JSON.parse(window.localStorage.getItem("recoil-persist")).aiChatAutoOpenSuppressed, true);
        h.attemptedOpens.length = 0;
        await h.hydrate({ relative });
        assert.deepEqual(h.attemptedOpens, [], "reload must not override a manual close");
        await React.act(async () => h.ui().toggle());
        assert.equal(h.store.get(h.atoms.aiChatAutoOpenSuppressedAtom), false, "rail open clears suppression");
        await React.act(async () => h.ui().toggle());
        await React.act(async () => h.ui().open());
        assert.equal(h.store.get(h.atoms.aiChatAutoOpenSuppressedAtom), false, "explicit welcome/shortcut open clears suppression");
        assert.ok(h.store.get(h.atoms.aiChatExplicitOpenAtAtom));
      });
    });
  }

  test(`${relative}: disabled setting and mobile do not auto-open; pin does`, async () => {
    await harness({ openAiChatByDefault: false }, async (h) => {
      await h.hydrate({ relative });
      assert.deepEqual(h.attemptedOpens, [], "saved disabled setting must be read before auto-open");
    });
    await harness({}, async (h) => {
      await h.hydrate({ relative, mobile: true });
      assert.deepEqual(h.attemptedOpens, [], "mobile never auto-opens");
    });
    await harness({ openAiChatByDefault: false, aiChatPinned: true }, async (h) => {
      await h.hydrate({ relative });
      assert.equal(h.store.get(h.atoms.showAIChatInterfaceAtom), true, "pin overrides default setting");
    });
  });
}

test("guest boards retain auto-open despite saved suppression", async () => {
  await harness({ openAiChatByDefault: false, aiChatAutoOpenSuppressed: true }, async (h) => {
    await h.hydrate({ relative: boardPath, guest: true });
    assert.equal(h.store.get(h.atoms.showAIChatInterfaceAtom), true);
  });
});

for (const relative of restorePaths) {
  test(`${relative}: stale session restore cannot undo a manual close`, async () => {
    await harness({ aiChatAutoOpenSuppressed: true }, async (h) => {
      window.sessionStorage.setItem("ht:aiChatOpen", "1");
      await h.hydrate({ relative });
      assert.deepEqual(h.attemptedOpens, [], "persisted close wins over a stale session-open value");
      assert.equal(h.store.get(h.atoms.aiChatAutoOpenSuppressedAtom), true);
    });
  });
  test(`${relative}: reload restore remains automatic and desktop-only`, async () => {
    await harness({}, async (h) => {
      window.sessionStorage.setItem("ht:aiChatOpen", "1");
      await h.hydrate({ relative });
      assert.equal(h.store.get(h.atoms.showAIChatInterfaceAtom), true);
      assert.equal(h.store.get(h.atoms.aiChatExplicitOpenAtAtom), null, "restore is not an explicit focus request");
    });
    await harness({}, async (h) => {
      window.innerWidth = 390;
      window.sessionStorage.setItem("ht:aiChatOpen", "1");
      await h.hydrate({ relative, mobile: true });
      assert.deepEqual(h.attemptedOpens, []);
    });
    await harness({}, async (h) => {
      window.sessionStorage.setItem("ht:aiChatOpen", "1");
      await h.hydrate({ relative, guest: true });
      assert.deepEqual(h.attemptedOpens, [], "guest session restoration stays disabled");
    });
  });
}

for (const [name, handler] of [["welcome link", welcomeOpen], ["pin", pinOpen]]) {
  test(`${name} explicitly opens chat and clears saved suppression`, async () => {
    await harness({ aiChatAutoOpenSuppressed: true }, async (h) => {
      await h.hydrate({ relative: boardPath });
      await React.act(async () => h.userOpen(handler));
      assert.equal(h.store.get(h.atoms.aiChatAutoOpenSuppressedAtom), false);
      assert.equal(h.store.get(h.atoms.showAIChatInterfaceAtom), true);
      assert.ok(h.store.get(h.atoms.aiChatExplicitOpenAtAtom));
    });
  });
}

test("Ctrl+Q before the runtime mounts explicitly opens chat and clears suppression", async () => {
  await harness({ aiChatAutoOpenSuppressed: true }, async (h) => {
    await h.hydrate({ relative: "ctrlQ" });
    await React.act(async () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "q", ctrlKey: true })));
    assert.equal(h.store.get(h.atoms.aiChatAutoOpenSuppressedAtom), false);
    assert.equal(h.store.get(h.atoms.showAIChatInterfaceAtom), true);
    assert.ok(h.store.get(h.atoms.aiChatExplicitOpenAtAtom));
  });
});
