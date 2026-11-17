const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { JSDOM } = require("jsdom");
const { loadModule: load } = require("./helpers/loadModule.cjs");

const TICKET_FLAG = "htpr-9018-quick-tips";
const QUICK_ADD_FLAG = "htpr-8265-task-shortcuts-writer-model";
const COMMAND_MENU_KEYCAP_CLASS = "px-1 font-semibold text-dense xl:text-content";

function atoms() {
  return {
    isAiChatSidebarModeAtom: { __name: "aiChatSidebar", __initial: false },
    isXScrollOnKanbanAtom: { __name: "xScroll", __initial: false },
    showAIChatInterfaceAtom: { __name: "aiChat", __initial: false },
    showCommandsAtom: { __name: "commands", __initial: { show: false } },
    showQuickTipsAtom: { __name: "quickTips", __initial: true },
    showShortcutsAtom: { __name: "shortcuts", __initial: false },
    appShellRailAtom: { __name: "rail", __initial: true },
    currentUserAtom: { __name: "user", __initial: { id: 7 } },
  };
}

function loadBar(ticketFlagOn) {
  const shortcutCalls = [];
  const store = atoms();
  const module = load("src/components/Global/BottomSettings_QuickTips.tsx", {
    "@/store": store,
    "@/lib/state": {
      useRecoilState: (atom) => {
        const [value, setValue] = React.useState(atom.__initial);
        return [value, (next) => { if (atom.__name === "shortcuts") shortcutCalls.push(next); setValue(next); }];
      },
      useRecoilValue: (atom) => atom.__initial,
    },
    "@/hooks/useFlag": { useFlag: (key) => key === TICKET_FLAG ? ticketFlagOn : key === QUICK_ADD_FLAG },
    "@/hooks/MultiPages/AIChat/useAiChatMainContentLayout": { useAiChatMainContentLayout: () => ({ mainContentWidth: "100%", sidebarRightOffsetPx: 0 }) },
    "@/hooks/RecoilRoot/useHypertasksRecoilStates": { default: () => ({ toggleShowCommands() {} }) },
    "@/hooks/MultiPages/HTC/useDarkMode": { default: () => ({ effectiveTheme: "light" }) },
    "@/hooks/General/useGetUserPreferences": { useGetUserPreferences: () => ({ data: { muteAnnouncements: true } }) },
    "@/lib/tutorial/learnTutorialState": { getLearnTutorialStorageKey: (id) => `learn-${id}`, isLearnTutorialEligiblePath: () => false },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/lib/configs/general.config": { CLASS_NAME_CONSTANTS: { BOTTOM_HTC: "bottom-htc" } },
    "@/lib/configs/tooltip.config": { tooltipConfig: { settings: { gear_button: {}, htc_button: {}, ai_chat_button: {} } } },
    "@/assets/test.png": { default: { src: "/unseen.png" } },
    "@/assets/output-onlinetools 1.png": { default: { src: "/seen.png" } },
    "@/assets/HTC_without_text.png": { default: { src: "/htc.png" } },
    "next/image": { default: ({ alt }) => React.createElement("img", { alt: alt ?? "" }) },
    "next/navigation": { usePathname: () => "/project-15", useSearchParams: () => new URLSearchParams("") },
    "lucide-react": { Settings: () => null, X: (props) => React.createElement("button", { ...props, "aria-label": "Dismiss tips" }) },
    "../Common/Tooltip": { default: () => null },
    "../Common/AIWriterButton": { default: () => null },
    "../Common/kbd": { default: ({ content, className }) => React.createElement("kbd", { className, "data-key": content }, content) },
    "../ProviderGlobal/useGlobalUIState": { useGlobalUIState: () => ({ toggleAIChatInterface() {}, toggleAnnouncements() {} }) },
    "../Modals/Settings/settingsNavigation": { useSettingsNavigation: () => ({ openSettings() {} }) },
  });
  return { Bar: module.default, shortcutCalls };
}

async function withDOM(run) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://app.hypertask.ai/project?id=15", pretendToBeVisual: true });
  const previous = { window: global.window, document: global.document, navigator: global.navigator, ResizeObserver: global.ResizeObserver, IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(global, { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true });
  global.ResizeObserver = class { observe() {} disconnect() {} };
  const { createRoot } = require("react-dom/client");
  const reactRoot = createRoot(dom.window.document.getElementById("root"));
  try { await run({ dom, reactRoot, container: dom.window.document.getElementById("root") }); }
  finally {
    await React.act(async () => reactRoot.unmount());
    Object.assign(global, previous);
    if (previous.ResizeObserver === undefined) delete global.ResizeObserver;
    dom.window.close();
  }
}

test("flag on: the bar keeps six tips, thin rules and the command menu keycaps", async () => {
  await withDOM(async ({ reactRoot, container }) => {
    const { Bar } = loadBar(true);
    await React.act(async () => reactRoot.render(React.createElement(Bar, { announcements: [] })));
    const bar = container.querySelector(".quick-tips-bar");
    assert.ok(bar, "the tips bar renders");
    assert.equal(bar.querySelectorAll(".rounded-full").length, 0, "no round dots are left in the bar");
    assert.equal(bar.querySelectorAll(".w-px").length, 6, "one 1px rule between tips and before the link");
    const keys = [...bar.querySelectorAll("kbd")];
    assert.deepEqual(keys.map((key) => key.dataset.key), ["CTRL", "K", "J", "K", "C", "N", "CTRL", "E", "/"]);
    for (const key of keys) assert.equal(key.className, COMMAND_MENU_KEYCAP_CLASS, "keycaps use the command menu style");
    const move = keys.filter((key) => ["J", "K"].includes(key.dataset.key));
    assert.equal(move[0].parentElement, move[1].parentElement, "J and K sit in one move tip");
    for (const hint of ["command center", "move", "add task", "quick add", "archive", "search"]) assert.match(bar.textContent, new RegExp(hint));
    assert.doesNotMatch(bar.textContent, /change board/i);
    assert.doesNotMatch(bar.textContent, /next column/i);
    assert.match(bar.className, /rounded-\[4px\]/);
    assert.match(bar.className, /px-3 py-1/);
  });
});

test("flag on: All shortcuts opens the shortcuts panel", async () => {
  await withDOM(async ({ reactRoot, container, dom }) => {
    const { Bar, shortcutCalls } = loadBar(true);
    await React.act(async () => reactRoot.render(React.createElement(Bar, { announcements: [] })));
    const link = [...container.querySelectorAll("button")].find((button) => button.textContent === "All shortcuts");
    assert.ok(link, "the bar ends with an All shortcuts link");
    await React.act(async () => link.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    assert.deepEqual(shortcutCalls, [true]);
  });
});

test("flag off: the bar keeps today's dots, keycaps and tip list", async () => {
  await withDOM(async ({ reactRoot, container }) => {
    const { Bar } = loadBar(false);
    await React.act(async () => reactRoot.render(React.createElement(Bar, { announcements: [] })));
    const bar = container.querySelector(".quick-tips-bar");
    assert.ok(bar, "the tips bar renders");
    assert.equal(bar.querySelectorAll(".rounded-full").length, 8, "the round dots are still there");
    assert.equal(bar.querySelectorAll(".w-px").length, 0, "no thin rules while the flag is off");
    assert.equal([...container.querySelectorAll("button")].filter((button) => button.textContent === "All shortcuts").length, 0);
    assert.match(bar.textContent, /change board/i);
    for (const key of bar.querySelectorAll("kbd")) assert.match(key.className, /bg-\[var\(--bg-quick-tip-key\)\]/);
  });
});
