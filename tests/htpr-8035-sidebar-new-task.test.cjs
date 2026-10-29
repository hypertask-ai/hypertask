const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

function load(file, dependencies) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  new Function("require", "exports", javascript)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected import: ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

const flagPath = "src/lib/flags/definitions/htpr-8035-sidebar-new-task.ts";
const flag = load(flagPath, {}).default;
const { CommandMode } = load("src/models/enums.ts", {});

function renderRail({ enabled = true, compose = true, wide = false, apple = false, settingsNamed = true, pathname = "/my-tasks" } = {}) {
  const updates = [];
  const navigation = [];
  const icon = (props) => React.createElement("svg", props);
  const dependencies = {
    "react": { ...React, useState: () => [false, () => {}], useMemo: (fn) => fn(), useCallback: (fn) => fn, useEffect: () => {}, useLayoutEffect: () => {} },
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/link": { __esModule: true, default: "a" },
    "next/dynamic": { __esModule: true, default: () => () => null },
    "next/navigation": { usePathname: () => pathname, useRouter: () => ({ push: (url) => navigation.push(url) }) },
    "lucide-react": new Proxy({}, { get: () => icon }),
    "@/components/Common/IconoirIcons": new Proxy({}, { get: () => icon }),
    "@/lib/constants": { __esModule: true, default: { timersRoute: "/time" } },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => apple },
    "@/components/ProviderGlobal/useGlobalUIState": { useGlobalUIState: () => ({ toggleLeftSidebar: () => navigation.push("boards") }) },
    "@/components/Common/Tooltip": { __esModule: true, default: ({ text, keyCombination }) => React.createElement("span", { "data-tooltip": text }, keyCombination.join("+")) },
    "./SearchFilterIcon": { __esModule: true, default: () => null },
    "@/store": { appShellRailExpandedAtom: "expanded", boardLayoutAtom: "layout", showCommandsAtom: "commands", showGuestLoginAtom: "login" },
    "@/lib/state": {
      useRecoilState: (atom) => [atom === "expanded" ? wide : "board", () => {}],
      useRecoilValue: () => null,
      useSetRecoilState: (atom) => (value) => updates.push({ atom, value }),
    },
    "@/models/enums": { CommandMode },
    "@/hooks/Homepage/useAppShellSurfaceShortcuts": { __esModule: true, default: () => ({ navigateToBoard: (layout) => navigation.push(layout) }), RAIL_TOGGLE_KEY: "0" },
    "@/hooks/MultiPages/Sidebar/useGetAnnouncements": { useGetAnnouncements: () => ({ data: [] }) },
    "@/hooks/General/useGetUserPreferences": { useGetUserPreferences: () => ({ data: {} }) },
    "@/lib/demo/isGuestClient": { isGuestCookieUser: () => false },
    "@/components/Modals/Settings/settingsNavigation": { useSettingsNavigation: () => ({ openSettings: () => navigation.push("settings") }) },
    "@tanstack/react-query": { useQueryClient: () => ({}) },
    "@/store/currentPageActions": { currentPageActionsAtom: "page-actions" },
    "@/hooks/useFlag": { useFlag: (key) => key === "htpr-8146-settings-name" ? settingsNamed : key === flag.key ? enabled : key === "htpr-6929-compose-task-writer" ? compose : false },
    "@/lib/flags/definitions/htpr-7298-standalone-pages": { HTPR_7298_STANDALONE_PAGES_FLAG: "pages" },
    "@/lib/flags/definitions/htpr-7309-pages-screens": { HTPR_7309_PAGES_SCREENS_FLAG: "screens" },
    "@/lib/flags/definitions/htpr-8146-settings-name": { HTPR_8146_SETTINGS_NAME_FLAG: "htpr-8146-settings-name" },
    "@/lib/flags/definitions/htpr-8035-sidebar-new-task": { HTPR_8035_SIDEBAR_NEW_TASK_FLAG: flag.key },
    "@/lib/flags/definitions/htpr-6929-compose-task-writer": { HTPR_6929_COMPOSE_TASK_WRITER_FLAG: "htpr-6929-compose-task-writer" },
    "@/hooks/Inbox/useGetNotifications": { prefetchInboxQuery: () => {} },
  };
  const Rail = load("src/components/PageComponents/Kanban/HeaderComponents/AppShellRail.tsx", dependencies).default;
  const tree = Rail({ variant: "global", currentUser: { id: 985 } });
  const nodes = [];
  function visit(node) {
    if (!React.isValidElement(node)) return;
    if (typeof node.type === "function") return visit(node.type(node.props));
    nodes.push(node);
    React.Children.forEach(node.props.children, visit);
  }
  visit(tree);
  return { nodes, updates, navigation, html: renderToStaticMarkup(tree) };
}

for (const wide of [false, true]) {
  test(`New Task opens the compose window without navigation (${wide ? "expanded" : "collapsed"})`, () => {
    const rail = renderRail({ wide });
    const buttons = rail.nodes.filter((node) => node.type === "button" && node.props["aria-label"] === "New Task");
    assert.equal(buttons.length, 1);
    buttons[0].props.onClick();
    assert.deepEqual(rail.updates, [{ atom: "commands", value: { show: true, mode: CommandMode.Command, paletteTab: "compose" } }]);
    assert.deepEqual(rail.navigation, []);
    assert.match(buttons[0].props.className, /hidden.*md:flex/);
    assert.match(buttons[0].props.className, /bg-shadcn-primary/);
    assert.match(rail.html, /CTRL\+J/);
    const position = (label) => rail.nodes.findIndex((node) => node.props["aria-label"] === label);
    assert.ok(position("New Task") > position("Search"));
    assert.ok(position("New Task") < position("Agents"));
    assert.match(rail.html, wide ? /w-\[130px\]/ : /w-\[48px\]/);
    for (const label of ["Your Kanban boards", "Board layout", "Table layout"]) {
      rail.nodes.find((node) => node.props["aria-label"] === label).props.onClick();
    }
    assert.deepEqual(rail.navigation, ["boards", "board", "table"]);
  });
}

test("feature off or compose unavailable leaves no new entry", () => {
  for (const options of [{ enabled: false }, { compose: false }]) {
    const rail = renderRail(options);
    assert.equal(rail.nodes.some((node) => node.props["aria-label"] === "New Task"), false);
    assert.ok(rail.nodes.some((node) => node.props["aria-label"] === "Your Kanban boards"));
  }
});

test("New Task is available across sidebar routes with platform-correct tooltip", () => {
  for (const pathname of ["/project", "/detail/project-7049/1", "/inbox", "/my-tasks", "/calendar", "/search"]) {
    assert.match(renderRail({ pathname, apple: true }).html, /CMD\+J/);
  }
});

test("the improvement ships to Everyone with a small reversible risk", () => {
  assert.equal(flag.key, "htpr-8035-sidebar-new-task");
  assert.equal(flag.kind, "improvement");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
});

for (const wide of [false, true]) {
  test(`Settings has its accessible name and still opens (${wide ? "expanded" : "collapsed"})`, () => {
    const on = renderRail({ wide });
    const off = renderRail({ wide, settingsNamed: false });
    const trigger = (rail) => rail.nodes.find((node) => node.props["data-testid"] === "app-shell-settings");
    assert.equal(trigger(on).props["aria-label"], "Settings");
    assert.equal(trigger(off).props["aria-label"], undefined);
    assert.equal(trigger(on).props.className, trigger(off).props.className);
    assert.equal(trigger(on).props.tabIndex, trigger(off).props.tabIndex);
    trigger(on).props.onClick();
    trigger(off).props.onClick();
    assert.deepEqual(on.navigation, ["settings"]);
    assert.deepEqual(off.navigation, ["settings"]);
    assert.equal(on.html.replace(' aria-label="Settings"', ""), off.html);
  });
}
