const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const React = require("react");
const { JSDOM } = require("jsdom");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") } });
const shortcuts = jiti(path.join(root, "src/lib/constants/commandCenterShortcut.ts"));
const { areGlobalShortcutsEnabled } = jiti(path.join(root, "src/lib/keyboard/globalShortcutRoutes.ts"));
const { CommandMode } = jiti(path.join(root, "src/models/enums.ts"));
const provider = "src/components/ProviderGlobal/GloablProviders.tsx";

// Execute the actual JSX and effect callbacks without booting unrelated API/auth providers.
function findNode(file, predicate) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (!found && predicate(node)) found = node;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, `Production boundary missing in ${file}`);
  return found.getText(source);
}

function evaluate(source, bindings) {
  const js = ts.transpileModule(`const boundary = (${source});`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function(...Object.keys(bindings), `${js}; return boundary;`)(...Object.values(bindings));
}

function effect(file, handlerName, bindings) {
  const callback = findNode(file, (node) => ts.isCallExpression(node) && node.expression.getText() === "useEffect" && node.arguments[0].getText().includes(`"keydown", ${handlerName}`));
  return evaluate(callback.slice("useEffect(".length, callback.lastIndexOf(", [")), bindings)();
}

function menu(pathname, show = true, authenticatedUserId = 1) {
  const expression = findNode(provider, (node) => ts.isJsxExpression(node) && node.expression?.getText().includes("showCommands.show") && node.expression.getText().includes("<HypertasksCommands"));
  return evaluate(expression.slice(1, -1), {
    React, ...shortcuts, pathname, authenticatedUserId, showCommands: { show }, HypertasksCommands: "command-menu",
  });
}

function keyboardFixture(pathname, isApple = false, authenticatedUserId = 1) {
  const dom = new JSDOM('<input aria-label="Search settings">');
  const document = dom.window.document;
  document.querySelector("input").focus();
  const showCommands = { show: false, mode: CommandMode.Command };
  let toggles = 0;
  const bindings = {
    ...shortcuts, document, pathname, isApple, authenticatedUserId, areGlobalShortcutsEnabled,
    composeEnabled: false,
    showTrialModal: false, showEmailVerificationModal: false, favorites: [],
    showCommands, handleKeyUp: () => {},
    isFavoriteBoardShortcut: jiti(path.join(root, "src/lib/constants/shortcuts.ts")).isFavoriteBoardShortcut,
    KeyCodes: jiti(path.join(root, "src/lib/constants/keyboard-handler.ts")).KeyCodes,
    toggleShowCommands: () => { toggles++; showCommands.show = !showCommands.show; },
  };
  const cleanup = effect("src/hooks/General/useCommandCenterShortcut.ts", "handleCommandCenterShortcut", bindings);
  return {
    document, bindings, showCommands, toggles: () => toggles,
    press: (key, modifiers = {}) => {
      const event = new dom.window.KeyboardEvent("keydown", {
        key, code: key === "k" ? "KeyK" : key, bubbles: true, cancelable: true, ...modifiers,
      });
      document.activeElement.dispatchEvent(event);
      return event;
    },
    close: () => { cleanup(); dom.window.close(); },
  };
}

for (const pathname of ["/settings", "/settings/board-general", "/settings/profile", "/settings/board-members", "/settings/slack/link", "/agents/chat", "/pages", "/timers", "/welcome", "/my-tasks"]) {
  test(`the shared shell renders the existing menu on ${pathname}`, () => {
    assert.equal(menu(pathname)?.type, "command-menu");
    assert.equal(menu(pathname, false), false);
  });
}

for (const pathname of ["/project", "/detail/project-15/6871", "/page/abc", "/search", "/inbox", "/inbox/agent", "/calendar", "/scheduled", "/reminders", "/report", "/all-tasks", "/starred", "/pinned", "/archived"]) {
  test(`the shell does not duplicate the contextual command host on ${pathname}`, () => {
    assert.equal(menu(pathname), false);
  });
}

for (const [name, isApple, modifiers] of [["Ctrl", false, { ctrlKey: true }], ["Cmd", true, { metaKey: true }]]) {
  test(`${name}+K works from settings search once, consumes competing handlers, and toggles closed`, () => {
    const page = keyboardFixture("/settings/profile", isApple);
    try {
      // A route's bubble listener may register before the shell's listener.
      let competingCalls = 0;
      page.document.addEventListener("keydown", () => { competingCalls++; });
      const first = page.press("k", modifiers);
      assert.equal(first.defaultPrevented, true);
      assert.equal(page.showCommands.show, true);
      assert.equal(page.toggles(), 1);
      assert.equal(competingCalls, 0);
      assert.equal(menu("/settings/profile", page.showCommands.show)?.type, "command-menu");
      page.press("k", modifiers);
      assert.equal(page.showCommands.show, false);
      assert.equal(page.toggles(), 2);
    } finally { page.close(); }
  });
}

test("settings search keeps ordinary keys and unrelated modifier combinations", () => {
  const page = keyboardFixture("/settings/profile");
  try {
    for (const modifiers of [{}, { ctrlKey: true, shiftKey: true }, { ctrlKey: true, altKey: true }]) {
      assert.equal(page.press("k", modifiers).defaultPrevented, false);
    }
    assert.equal(page.toggles(), 0);
    assert.equal(page.document.activeElement.tagName, "INPUT");
  } finally { page.close(); }
});

test("capture consumes a legacy route shortcut even when its bubble listener registers first", () => {
  const page = keyboardFixture("/inbox");
  try {
    let localToggles = 0;
    page.document.querySelector("input").addEventListener("keydown", () => { localToggles++; });
    page.press("k", { ctrlKey: true });
    assert.equal(page.showCommands.show, true);
    assert.equal(localToggles, 0);
  } finally { page.close(); }
});

test("Escape closes the real command menu without closing settings, then closes settings normally", () => {
  const page = keyboardFixture("/settings/board-general");
  let settingsClosed = 0;
  let resets = 0;
  try {
    page.showCommands.show = true;
    const cleanupSettings = effect("src/components/Modals/Settings/SettingsShell.tsx", "handleKeydown", {
      document: page.document, showCommands: page.showCommands, showFeedback: false,
      closeSettings: () => { settingsClosed++; }, setShowFeedback: () => {},
    });
    const cleanupCommands = effect("src/components/commands.tsx", "keyPressHandler", {
      document: page.document, showCommands: page.showCommands, commandMode: CommandMode.Command,
      CommandMode, setCommandMode: () => {}, setTimeout: (callback) => callback(),
      resetShowCommands: () => { resets++; page.showCommands.show = false; },
    });
    page.press("Escape");
    assert.equal(page.showCommands.show, false);
    assert.equal(resets, 1);
    assert.equal(settingsClosed, 0);
    cleanupCommands();
    page.press("Escape");
    assert.equal(settingsClosed, 1);
    cleanupSettings();
  } finally { page.close(); }
});

test("My Tasks navigation uses the real dispatcher from a settings palette and closes it", () => {
  function load(file) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const loaded = { exports: {} };
    new Function("require", "module", "exports", js)((name) => {
      if (name === "@/models/enums") return { CommandMode };
      if (name === "@/lib/constants") return jiti(path.join(root, "src/lib/constants/index.ts"));
      return {};
    }, loaded, loaded.exports);
    return loaded.exports;
  }
  const pushes = [];
  let closed = 0;
  const context = {
    pathname: "/settings/profile", setShowCommands: () => {}, setCommandMode: () => {},
    boardCloseHandler: () => { closed++; }, router: { push: (href) => pushes.push(href) },
  };
  const { GoToHandler } = load("src/components/generalCommandActions.ts").createGeneralCommandActions(context);
  const dispatcher = load("src/components/commandDispatcher.ts").createCommandDispatcher({ ...context, GoToHandler });
  dispatcher.handleAction(CommandMode.GoToMyTasks);
  assert.deepEqual(pushes, ["/my-tasks"]);
  assert.equal(closed, 1);
});

for (const pathname of ["/login", "/qa/login", "/invite/team", "/reset", "/pricing", "/oauth/login", "/cli-auth", "/share/project", "/verify-email", "/trial", "/unauthorized", "/onboarding", "/interactive-onboarding/inbox", "/new", "/learn"]) {
  test(`${pathname} does not consume Ctrl+K or mount a workspace menu`, () => {
    const page = keyboardFixture(pathname, true);
    try {
      let nativeCalls = 0;
      page.document.addEventListener("keydown", () => { nativeCalls++; });
      assert.equal(page.press("k", { ctrlKey: true }).defaultPrevented, false);
      assert.equal(page.press("k", { metaKey: true }).defaultPrevented, false);
      assert.equal(page.toggles(), 0);
      assert.equal(nativeCalls, 2);
      assert.equal(menu(pathname), false);
    } finally { page.close(); }
  });
}

for (const pathname of ["/project", "/inbox", "/calendar", "/all-tasks", "/pinned", "/starred", "/archived", "/reminders", "/scheduled", "/search", "/detail/project-15/6871", "/page/abc", "/report/project-15/velocity"]) {
  test(`${pathname} toggles only once even with competing bubble and capture handlers`, () => {
    const page = keyboardFixture(pathname);
    try {
      let competingToggles = 0;
      page.document.addEventListener("keydown", () => { competingToggles++; }, true);
      page.document.addEventListener("keydown", () => { competingToggles++; });
      page.press("k", { ctrlKey: true });
      assert.equal(page.toggles(), 1);
      assert.equal(page.showCommands.show, true);
      assert.equal(competingToggles, 0);
      page.press("k", { ctrlKey: true });
      assert.equal(page.toggles(), 2);
      assert.equal(page.showCommands.show, false);
      assert.equal(competingToggles, 0);
    } finally { page.close(); }
  });
}

for (const pathname of ["/settings/profile", "/my-tasks", "/agents/chat", "/project"]) {
  test(`a signed-out shell on ${pathname} cannot toggle or render the menu`, () => {
    const page = keyboardFixture(pathname, true, null);
    try {
      assert.equal(page.press("k", { ctrlKey: true }).defaultPrevented, false);
      assert.equal(page.press("k", { metaKey: true }).defaultPrevented, false);
      assert.equal(page.toggles(), 0);
      assert.equal(menu(pathname, true, null), false);
    } finally { page.close(); }
  });
}
