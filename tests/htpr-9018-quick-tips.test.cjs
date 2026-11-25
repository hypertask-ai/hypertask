const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { mount } = require("./helpers/htpr-7260-ui.cjs");
const { loadModule } = require("./helpers/loadModule.cjs");

const TICKET_FLAG = "htpr-9018-quick-tips";
const QUICK_ADD_FLAG = "htpr-8265-task-shortcuts-writer-model";
const COMMAND_MENU_KEYCAP = "bg-label-span";
const TODAY_KEYCAP = "bg-[var(--bg-quick-tip-key)]";

function atoms() {
  return {
    isAiChatSidebarModeAtom: { __name: "aiChatSidebar", __initial: false },
    isXScrollOnKanbanAtom: { __name: "xScroll", __initial: false },
    showAIChatInterfaceAtom: { __name: "aiChat", __initial: false },
    showCommandsAtom: { __name: "commands", __initial: { show: false } },
    showQuickTipsAtom: { __name: "quickTips", __initial: true },
    appShellRailAtom: { __name: "rail", __initial: true },
    currentUserAtom: { __name: "user", __initial: { id: 7 } },
  };
}

function loadBar({ ticketFlagOn, quickAddOn = true }) {
  const opened = [];
  const loaded = loadModule("src/components/Global/BottomSettings_QuickTips.tsx", {
    "@/store": atoms(),
    "@/lib/state": {
      useRecoilState: (atom) => React.useState(atom.__initial),
      useRecoilValue: (atom) => atom.__initial,
    },
    "@/hooks/useFlag": {
      useFlag: (key) =>
        key === TICKET_FLAG ? ticketFlagOn : key === QUICK_ADD_FLAG ? quickAddOn : false,
    },
    "@/hooks/MultiPages/AIChat/useAiChatMainContentLayout": {
      useAiChatMainContentLayout: () => ({ mainContentWidth: "100%", sidebarRightOffsetPx: 0 }),
    },
    "@/hooks/RecoilRoot/useHypertasksRecoilStates": {
      default: () => ({ toggleShowCommands() {}, openShortcuts: () => opened.push(true) }),
    },
    "@/hooks/MultiPages/HTC/useDarkMode": { default: () => ({ effectiveTheme: "light" }) },
    "@/hooks/General/useGetUserPreferences": {
      useGetUserPreferences: () => ({ data: { muteAnnouncements: true } }),
    },
    "@/lib/tutorial/learnTutorialState": {
      getLearnTutorialStorageKey: (id) => `learn-${id}`,
      isLearnTutorialEligiblePath: () => false,
    },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/lib/configs/general.config": { CLASS_NAME_CONSTANTS: { BOTTOM_HTC: "bottom-htc" } },
    "@/lib/configs/tooltip.config": {
      tooltipConfig: { settings: { gear_button: {}, htc_button: {}, ai_chat_button: {} } },
    },
    "@/assets/test.png": { default: { src: "/unseen.png" } },
    "@/assets/output-onlinetools 1.png": { default: { src: "/seen.png" } },
    "@/assets/HTC_without_text.png": { default: { src: "/htc.png" } },
    "next/image": { default: ({ alt }) => React.createElement("img", { alt: alt ?? "" }) },
    "next/navigation": {
      usePathname: () => "/project-15",
      useSearchParams: () => new URLSearchParams(""),
    },
    "lucide-react": {
      Settings: () => null,
      X: (props) => React.createElement("button", { ...props, "aria-label": "Dismiss tips" }),
    },
    "../Common/Tooltip": { default: () => null },
    "../Common/AIWriterButton": { default: () => null },
    "../Common/kbd": {
      default: ({ content, className }) =>
        React.createElement("kbd", { className, "data-key": content }, content),
    },
    "../ProviderGlobal/useGlobalUIState": {
      useGlobalUIState: () => ({ toggleAIChatInterface() {}, toggleAnnouncements() {} }),
    },
    "../Modals/Settings/settingsNavigation": {
      useSettingsNavigation: () => ({ openSettings() {} }),
    },
  });
  return { Bar: loaded.default, opened };
}

async function renderBar(options) {
  const { Bar, opened } = loadBar(options);
  const ui = mount();
  const observer = global.ResizeObserver;
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  ui.render(React.createElement(Bar, { announcements: [] }));
  const bar = ui.container.querySelector(".quick-tips-bar");
  return {
    bar,
    opened,
    keys: () => [...bar.querySelectorAll("kbd")],
    async close() {
      ui.close();
      if (observer === undefined) delete global.ResizeObserver;
      else global.ResizeObserver = observer;
    },
  };
}

test("flag on: six tips, thin rules and the command menu keycaps", async () => {
  const view = await renderBar({ ticketFlagOn: true });
  try {
    const { bar, keys } = view;
    assert.ok(bar, "the tips bar renders");
    assert.equal(bar.querySelectorAll(".rounded-full").length, 0, "no round dots are left in the bar");
    assert.equal(bar.querySelectorAll(".w-px").length, 6, "five rules between tips and one before the link");
    const keycaps = keys();
    assert.deepEqual(
      keycaps.map((key) => key.dataset.key),
      ["CTRL", "K", "J", "K", "C", "N", "CTRL", "E", "/"],
    );
    for (const key of keycaps) {
      assert.match(key.className, new RegExp(COMMAND_MENU_KEYCAP), "keycaps use the command menu style");
      assert.doesNotMatch(key.className, /bg-\[var\(--bg-quick-tip-key\)\]/);
    }
    const move = keycaps.filter((key) => ["J", "K"].includes(key.dataset.key));
    assert.equal(move[0].parentElement, move[1].parentElement, "J and K sit in one move tip");
    for (const hint of ["command center", "move", "add task", "quick add", "archive", "search"]) {
      assert.match(bar.textContent, new RegExp(hint));
    }
    assert.doesNotMatch(bar.textContent, /change board/i);
    assert.doesNotMatch(bar.textContent, /next column/i);
    assert.match(bar.className, /rounded-\[4px\]/);
    assert.match(bar.className, /px-3 py-1/);
  } finally {
    await view.close();
  }
});

test("flag on: All shortcuts opens the shortcuts panel", async () => {
  const view = await renderBar({ ticketFlagOn: true });
  try {
    const link = [...view.bar.querySelectorAll("button")].find(
      (button) => button.textContent === "All shortcuts",
    );
    assert.ok(link, "the bar ends with an All shortcuts link");
    await React.act(async () => link.click());
    assert.deepEqual(view.opened, [true]);
  } finally {
    await view.close();
  }
});

test("flag on: the quick add tip follows the shortcut writer flag", async () => {
  const view = await renderBar({ ticketFlagOn: true, quickAddOn: false });
  try {
    const contents = view.keys().map((key) => key.dataset.key);
    assert.ok(contents.includes("N / Shift+C"), "quick add reads N / Shift+C when N is not the key");
  } finally {
    await view.close();
  }
});

test("flag off: the bar keeps today's dots, keycaps and tip list", async () => {
  const view = await renderBar({ ticketFlagOn: false });
  try {
    const { bar } = view;
    assert.ok(bar, "the tips bar renders");
    assert.equal(bar.querySelectorAll(".rounded-full").length, 8, "the round dots are still there");
    assert.equal(bar.querySelectorAll(".w-px").length, 0, "no thin rules while the flag is off");
    assert.equal(
      [...bar.querySelectorAll("button")].filter((button) => button.textContent === "All shortcuts").length,
      0,
    );
    assert.match(bar.textContent, /change board/i);
    assert.doesNotMatch(bar.className, /rounded-\[4px\]/);
    for (const key of view.keys()) {
      assert.ok(key.className.includes(TODAY_KEYCAP), "today's keycap style is unchanged");
    }
  } finally {
    await view.close();
  }
});
