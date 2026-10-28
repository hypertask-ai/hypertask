const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { JSDOM } = require("jsdom");
const { createStore, Provider } = require("jotai");
const { loadModule: load } = require("./helpers/loadModule.cjs");
const { load: loadRoute } = require("./task-route-loader.cjs");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const flagKey = "htpr-7885-invite-link-dialog";
const { CommandMode } = loadRoute("src/models/enums.ts", {});
const { getNextRouterAwareHistoryState } = loadRoute("src/lib/navigation/nextHistoryState.ts", {});
const state = load("src/lib/state.tsx", { "@/hooks/General/useHydrated": { useHydrated: () => true } });
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function sourceNode(file, predicate) {
  const tree = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (predicate(node, tree)) found = node;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(found, `Production boundary must exist in ${file}`);
  return found.getText(tree);
}

function inviteLinkComponent(atoms, flags) {
  const source = read("src/app/[...boardURL]/LandingPage.tsx");
  const start = source.indexOf("const inviteRequested =");
  const end = source.indexOf("const readyBoardRender =", start);
  assert.ok(start >= 0 && end > start, "Load the real invite hooks and effect, not a copied implementation");
  const code = compile(`
    const { useEffect, useRef, useState } = React;
    const { useRecoilState, useRecoilValue, useSetRecoilState } = state;
    const { showCommandsAtom, currentProjectAtom } = atoms;
    const HTPR_7028_FIRST_TASK_EMAIL_FLAG = "htpr-7028-first-task-email";
    const HTPR_7885_INVITE_LINK_DIALOG_FLAG = "htpr-7885-invite-link-dialog";
    const useFlag = (key) => flags[key] === true;
    function InviteLink({ settings }) {
      const { searchParams, authenticated, isGuest, boardDataReady, currentBoardAccessStatus,
        readyProject, requestedProjectId, user, isMblForChat } = settings;
      ${source.slice(start, end)}
      return null;
    }
  `);
  return new Function("React", "state", "atoms", "flags", "CommandMode", "getNextRouterAwareHistoryState", `${code}\nreturn InviteLink;`)(
    React, state, atoms, flags, CommandMode, getNextRouterAwareHistoryState,
  );
}

async function withInvite(options, check) {
  const dom = new JSDOM("<div id='root'></div>", { url: options.url ?? "https://fixture.test/project?id=7&invite=1&view=board#keep" });
  const previous = ["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]);
  Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = require("react-dom/client");
  const root = createRoot(document.getElementById("root"));
  const store = createStore();
  const commandDeclaration = sourceNode("src/store/index.ts", (node, tree) => ts.isVariableDeclaration(node) && node.name.getText(tree) === "showCommandsAtom");
  const showCommandsAtom = new Function("atom", "CommandMode", compile(`return ${commandDeclaration.slice(commandDeclaration.indexOf("=") + 1)};`))(state.atom, CommandMode);
  const currentProjectAtom = state.atom({ key: "invite-link-project", default: { id: 7 } });
  const flags = { [flagKey]: options.enabled !== false };
  const InviteLink = inviteLinkComponent({ showCommandsAtom, currentProjectAtom }, flags);
  const resetEffect = sourceNode("src/components/ProviderGlobal/GloablProviders.tsx", (node, tree) =>
    ts.isCallExpression(node) && node.expression.getText(tree) === "useEffect" && node.arguments[0]?.getText(tree).trim() === "() => {\n    resetShowCommands();\n  }");
  const useStartupReset = new Function("useEffect", "resetShowCommands", "pathname", compile(resetEffect));
  const writes = [];
  const visibleModes = [];
  const strips = [];
  const unsubscribe = store.sub(showCommandsAtom, () => writes.push({ ...store.get(showCommandsAtom), invite: new URL(window.location.href).searchParams.get("invite") }));
  const replaceState = window.history.replaceState.bind(window.history);
  window.history.replaceState({ __NA: true, _N: true, keep: "router-state" }, "");
  window.history.replaceState = (...args) => {
    strips.push({ command: store.get(showCommandsAtom), visibleModes: [...visibleModes] });
    return replaceState(...args);
  };
  const settings = {
    searchParams: new URLSearchParams(window.location.search), authenticated: true, isGuest: false,
    boardDataReady: true, currentBoardAccessStatus: "authorized", readyProject: { id: 7 },
    requestedProjectId: 7, user: { id: 985 }, isMblForChat: options.mobile === true, ...options.settings,
  };
  function Palette() {
    const command = state.useRecoilValue(showCommandsAtom);
    React.useLayoutEffect(() => {
      if (command.show) visibleModes.push(command.mode);
    }, [command]);
    return command.show ? React.createElement("div", { role: "dialog", "data-mode": command.mode }, "Invite dialog") : null;
  }
  function StartupReset() {
    const resetShowCommands = state.useResetRecoilState(showCommandsAtom);
    useStartupReset(React.useEffect, resetShowCommands, "/project");
    return React.createElement(React.Fragment, null, React.createElement(InviteLink, { settings }), React.createElement(Palette));
  }
  const render = async () => React.act(async () => root.render(React.createElement(Provider, { store }, React.createElement(StartupReset))));
  const close = async () => React.act(async () => store.set(showCommandsAtom, { show: false, mode: CommandMode.Command }));
  try {
    await render();
    await check({ store, showCommandsAtom, writes, visibleModes, strips, settings, render, close });
  } finally {
    await React.act(async () => root.unmount());
    unsubscribe();
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
  }
}

test("flag on restores InviteMember after startup reset, then consumes the link without reopening on close", async () => {
  await withInvite({}, async ({ store, showCommandsAtom, writes, visibleModes, strips, render, close }) => {
    assert.deepEqual(writes.map(({ show, mode, invite }) => [show, mode, invite]), [
      [true, CommandMode.InviteMember, "1"],
      [false, CommandMode.Command, "1"],
      [true, CommandMode.InviteMember, "1"],
    ]);
    assert.deepEqual(store.get(showCommandsAtom), { show: true, mode: CommandMode.InviteMember });
    assert.equal(document.querySelector('[role="dialog"]').dataset.mode, String(CommandMode.InviteMember));
    assert.deepEqual(visibleModes, [CommandMode.InviteMember]);
    assert.equal(strips.length, 1);
    assert.deepEqual(strips[0], { command: { show: true, mode: CommandMode.InviteMember }, visibleModes: [CommandMode.InviteMember] });
    assert.equal(window.location.search, "?id=7&view=board");
    assert.equal(window.location.hash, "#keep");
    assert.deepEqual(window.history.state, { keep: "router-state" });
    await close();
    await render();
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(writes.filter(({ show }) => show).length, 2);
    assert.equal(strips.length, 1);
  });
});

for (const [name, options] of [["flag off", { enabled: false }], ["phone", { mobile: true }]]) {
  test(`${name} keeps the existing one-shot link behavior and does not reopen after startup reset`, async () => {
    await withInvite(options, async ({ store, showCommandsAtom, writes, strips, visibleModes, render }) => {
      assert.deepEqual(writes.map(({ show, mode, invite }) => [show, mode, invite]), [
        [true, CommandMode.InviteMember, "1"],
        [false, CommandMode.Command, null],
      ]);
      assert.deepEqual(store.get(showCommandsAtom), { show: false, mode: CommandMode.Command });
      assert.equal(document.querySelector('[role="dialog"]'), null);
      assert.deepEqual(visibleModes, []);
      assert.equal(strips.length, 1);
      assert.equal(window.location.search, "?id=7&view=board");
      await render();
      assert.equal(writes.filter(({ show }) => show).length, 1);
    });
  });
}

test("a ready desktop link without the startup race opens once and does not reopen after a user closes it", async () => {
  await withInvite({ settings: { boardDataReady: false } }, async ({ writes, settings, render, close, visibleModes, strips }) => {
    assert.equal(writes.some(({ show }) => show), false);
    settings.boardDataReady = true;
    await render();
    assert.deepEqual(visibleModes, [CommandMode.InviteMember]);
    assert.equal(writes.filter(({ show }) => show).length, 1);
    assert.equal(strips.length, 1);
    await close();
    settings.searchParams = new URLSearchParams(window.location.search);
    await render();
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(writes.filter(({ show }) => show).length, 1);
  });
});

for (const [name, options] of [
  ["no invite parameter", { url: "https://fixture.test/project?id=7" }],
  ["unauthenticated", { settings: { authenticated: false } }],
  ["guest", { settings: { isGuest: true } }],
  ["unhydrated board", { settings: { boardDataReady: false } }],
  ["unauthorized board", { settings: { currentBoardAccessStatus: "denied" } }],
  ["wrong ready board", { settings: { readyProject: { id: 8 } } }],
  ["wrong current board", { settings: { requestedProjectId: 8, readyProject: { id: 8 } } }],
]) {
  test(`${name} never opens or consumes an invite link`, async () => {
    await withInvite(options, async ({ writes, strips }) => {
      assert.equal(writes.some(({ show }) => show), false);
      assert.equal(strips.length, 0);
      assert.equal(document.querySelector('[role="dialog"]'), null);
    });
  });
}

test("invite-link flag follows the approved low-risk bugfix definition", () => {
  const definition = loadRoute("src/lib/flags/definitions/htpr-7885-invite-link-dialog.ts", {});
  assert.equal(definition.HTPR_7885_INVITE_LINK_DIALOG_FLAG, flagKey);
  assert.deepEqual(definition.default, {
    key: flagKey,
    kind: "bugfix",
    defaultMode: "EVERYONE",
    shippedOn: "2026-10-25",
    description: "Restores the invite dialog for desktop board links carrying invite=1 after the startup palette reset.",
    releaseRisk: {
      risk: "small",
      reason: "Only re-opens the invite dialog for a board link carrying invite=1 on desktop. Off keeps today's behavior; phone and board Invite button behavior are unchanged.",
    },
  });
});
