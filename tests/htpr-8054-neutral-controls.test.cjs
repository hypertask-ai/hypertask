const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");

function load(file, mocks = {}) {
  const mod = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function("require", "module", "exports", compiled)((name) => {
    if (Object.hasOwn(mocks, name)) return { __esModule: true, ...mocks[name] };
    if (name.startsWith("@/") || name.startsWith("./") || name.startsWith("../")) throw new Error(`Unstubbed dependency: ${name}`);
    return require(name);
  }, mod, mod.exports);
  return mod.exports;
}

const flag = "htpr-8054-graphite-2";
const inboxFlag = "htpr-8264-inbox-row-fill";
const iconoir = load("src/components/Common/IconoirIcons.tsx");
const icon = () => React.createElement("svg");
const tooltip = () => null;
const hookReact = { ...React, useState: () => [false, () => {}], useMemo: (fn) => fn(), useCallback: (fn) => fn, useEffect: () => {}, useLayoutEffect: () => {} };
const cn = (...values) => values.filter(Boolean).join(" ");

function common(enabled) {
  return {
    "@/hooks/useFlag": { useFlag: (key) => key === flag && enabled },
    "@/lib/flags/definitions/htpr-8054-graphite-2": { HTPR_8054_GRAPHITE_2_FLAG: flag },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/utils/undoActions/helperFuncs": { cn },
  };
}

function documentFor(element, theme) {
  const html = renderToStaticMarkup(React.createElement("div", { className: theme }, element));
  return new JSDOM(html).window.document;
}

function renderControls(enabled, theme) {
  const mocks = common(enabled);
  const Writer = load("src/components/Common/AIWriterButton.tsx", { ...mocks, "./Tooltip": { default: tooltip } }).default;
  const { DesktopAttachment } = load("src/components/Common/AttachmentsUpload/AttachmentControls.tsx", {
    ...mocks,
    "lucide-react": { Check: icon, Paperclip: icon, PencilSparkles: icon, Trash2: icon },
    "../Tooltip": { default: tooltip },
    "@/hooks/General/useGetUserPreferences": { useGetUserPreferences: () => ({ data: {} }) },
    "@/models/model": {},
    "@/components/RTE/Components/AudioButton": { AudioButton: () => null },
    "@/lib/configs/general.config": { MOBILE_TARGET: "" },
    "@/components/Common/SendArrow": { SendArrow: icon },
  });
  return documentFor(React.createElement(React.Fragment, null,
    React.createElement(Writer, { id: "writer" }),
    React.createElement(DesktopAttachment, { mode: "create-comment", editor: null, handleAttachmentClick: () => {}, handleDiscardDrafts: () => {} })
  ), theme);
}

function renderRail({ enabled, wide, pathname, inboxRowFill, board = false }) {
  const { CommandMode } = load("src/models/enums.ts");
  const mocks = {
    ...common(enabled),
    react: hookReact,
    "next/link": { default: "a" },
    "next/dynamic": { default: () => () => null },
    "next/navigation": { usePathname: () => pathname, useRouter: () => ({ push: () => {} }) },
    "lucide-react": { Bot: icon, ChevronLeft: icon, ChevronRight: icon, CreditCard: icon, FileText: icon, Inbox: icon, LogIn: icon, Plus: icon, Timer: icon },
    "@/components/Common/IconoirIcons": iconoir,
    "@/lib/constants": { default: { timersRoute: "/time" } },
    "@/components/ProviderGlobal/useGlobalUIState": { useGlobalUIState: () => ({ toggleLeftSidebar: () => {}, toggleAIChatInterface: () => {} }) },
    "@/components/Common/Tooltip": { default: tooltip },
    "./SearchFilterIcon": { default: ({ className }) => React.createElement("button", { className, "aria-label": "Project search" }) },
    "@/store": { appShellRailExpandedAtom: "expanded", boardLayoutAtom: "layout", showCommandsAtom: "commands", showGuestLoginAtom: "login" },
    "@/lib/state": { useRecoilState: (atom) => [atom === "expanded" ? wide : "board", () => {}], useRecoilValue: () => null, useSetRecoilState: () => () => {} },
    "@/models/enums": { CommandMode },
    "@/hooks/Homepage/useAppShellSurfaceShortcuts": { default: () => ({ navigateToBoard: () => {} }), RAIL_TOGGLE_KEY: "0" },
    "@/hooks/MultiPages/Sidebar/useGetAnnouncements": { useGetAnnouncements: () => ({ data: [] }) },
    "@/hooks/General/useGetUserPreferences": { useGetUserPreferences: () => ({ data: {} }) },
    "@/lib/demo/isGuestClient": { isGuestCookieUser: () => false },
    "@/components/Modals/Settings/settingsNavigation": { useSettingsNavigation: () => ({ openSettings: () => {} }) },
    "@tanstack/react-query": { useQueryClient: () => ({}) },
    "@/store/currentPageActions": { currentPageActionsAtom: "page-actions" },
    "@/hooks/useFlag": { useFlag: (key) => key === flag ? enabled : key === inboxFlag ? inboxRowFill : ["new-task", "pages", "screens"].includes(key) },
    "@/lib/flags/definitions/htpr-7298-standalone-pages": { HTPR_7298_STANDALONE_PAGES_FLAG: "pages" },
    "@/lib/flags/definitions/htpr-7309-pages-screens": { HTPR_7309_PAGES_SCREENS_FLAG: "screens" },
    "@/lib/flags/definitions/htpr-8146-settings-name": { HTPR_8146_SETTINGS_NAME_FLAG: "settings" },
    "@/lib/flags/definitions/htpr-8035-sidebar-new-task": { HTPR_8035_SIDEBAR_NEW_TASK_FLAG: "new-task" },
    "@/lib/flags/definitions/htpr-8035-new-task-fill": { HTPR_8035_NEW_TASK_FILL_FLAG: "fill" },
    "@/lib/flags/definitions/htpr-8264-inbox-row-fill": { HTPR_8264_INBOX_ROW_FILL_FLAG: inboxFlag },
    "@/hooks/Inbox/useGetNotifications": { prefetchInboxQuery: () => {} },
  };
  const Rail = load("src/components/PageComponents/Kanban/HeaderComponents/AppShellRail.tsx", mocks).default;
  return documentFor(React.createElement(Rail, { variant: board ? "board" : "global", currentUser: { id: 985 }, currentProject: board ? { id: 1, timeTrackingEnabled: true } : null }), "");
}

for (const theme of ["light", "amoled", "graphite-2"]) {
  test(`AI controls use the flag's colour in ${theme}`, () => {
    for (const enabled of [false, true]) {
      const doc = renderControls(enabled, theme);
      for (const selector of ["#writer", "#create-comment-ai-writer-button"]) {
        const control = doc.querySelector(selector);
        assert.ok(control, selector);
        assert.equal(control.classList.contains("text-white-black"), enabled);
        assert.equal(control.classList.contains("text-hypertasks-ai-purple"), !enabled);
      }
    }
  });
}

test("rail controls and their RailItem wrappers use flag-controlled corners", () => {
  for (const enabled of [false, true]) for (const wide of [false, true]) for (const board of [false, true]) {
    const doc = renderRail({ enabled, wide, board, pathname: "/my-tasks", inboxRowFill: false });
    const expected = enabled ? "rounded-[4px]" : "rounded-[5px]";
    const opposite = enabled ? "rounded-[5px]" : "rounded-[4px]";
    const labels = ["Your Kanban boards", "Go to inbox", "Board layout", "Table layout", "Go to calendar", "AI Chat", board ? "Project search" : "Search", "Agents"];
    if (board) labels.push("Running timers");
    for (const label of labels) {
      const control = doc.querySelector(`[aria-label="${label}"]`);
      assert.ok(control, label);
      for (const element of [control, control.parentElement]) {
        assert.ok(element.classList.contains(expected), label);
        assert.ok(!element.classList.contains(opposite), label);
      }
    }
    for (const control of [doc.querySelector('[aria-label="New Task"]'), doc.querySelector('a[href="/pages"]')]) {
      assert.ok(control);
      assert.ok(control.classList.contains(expected));
      assert.ok(!control.classList.contains(opposite));
    }
  }
});

test("AI Chat glyph preserves inbox row fill behavior when the ticket flag is off", () => {
  for (const enabled of [false, true]) for (const wide of [false, true]) for (const pathname of ["/inbox", "/my-tasks"]) for (const inboxRowFill of [false, true]) {
    const doc = renderRail({ enabled, wide, pathname, inboxRowFill });
    const chat = doc.querySelector('[aria-label="AI Chat"]');
    const expected = enabled || (pathname === "/inbox" && inboxRowFill) ? iconoir.IconoirChat : iconoir.IconoirSparks;
    const glyph = renderToStaticMarkup(React.createElement(expected, { size: 18, strokeWidth: 1.5 }));
    assert.equal(chat.querySelector("svg").outerHTML, glyph);
    assert.equal(doc.querySelector("aside").hasAttribute("data-inbox-rail"), pathname === "/inbox" && inboxRowFill);
  }
});
