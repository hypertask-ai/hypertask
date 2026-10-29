const assert = require("node:assert/strict");
const test = require("node:test");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

const flag = "htpr-8030-chat-open-race";
const noop = () => {};

function opener({ enabled = true, open = false } = {}) {
  const state = { open };
  const atoms = {
    showAIChatInterfaceAtom: "chat", showQuickTipsAtom: "tips",
    aiChatAutoOpenSuppressedAtom: "suppressed", aiChatExplicitOpenAtAtom: "explicit",
    aiChatPinnedAtom: "pinned", showBoardManagerAtom: "boards", showShortcutsAtom: "shortcuts",
    showCommandsAtom: "commands", showSidebarAtom: "sidebar", showAnnouncementsAtom: "announcements",
    showScrollSettingModalAtom: "scroll",
  };
  const load = loader({
    "next/navigation": { usePathname: () => "/project" },
    "@/hooks/useFlag": { useFlag: (key) => key === flag && enabled, useFlagReady: () => true },
    "@/lib/flags/definitions/htpr-8030-chat-open-race": { HTPR_8030_CHAT_OPEN_RACE_FLAG: flag },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "@/lib/contexts/Multipages/AI_Agent/chatContext": {
      useOptionalAiChatContext: () => ({
        isSidebarMode: true, showAiChatInterface: false, showRenameChatModal: false,
        currentSession: undefined, togglePopover: noop,
      }),
    },
    "@/store": atoms,
    "@/lib/state": {
      useRecoilState: (atom) => [atom === "chat" ? state.open : false, (value) => {
        if (atom === "chat") state.open = typeof value === "function" ? value(state.open) : value;
      }],
      useResetRecoilState: () => noop,
      useSetRecoilState: () => noop,
    },
    "@/components/Common/Tooltip": { default: () => null },
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
  });
  const Panels = load("src/components/AI_CHAT/AI_Chat_Layout.tsx").default;
  const view = mount();
  view.render(React.createElement(Panels));
  return { ...view, state, click() {
    const button = view.container.querySelector('[aria-label="Open AI chat"]');
    assert.ok(button);
    React.act(() => button.click());
    view.render(React.createElement(Panels));
  } };
}

for (const enabled of [false, true]) {
  test(`closed chat opens with flag ${enabled}`, () => {
    const view = opener({ enabled });
    try { view.click(); assert.equal(view.state.open, true); } finally { view.close(); }
  });
}

test("Open keeps an already-open chat open while published context catches up", () => {
  const view = opener({ open: true });
  try { view.click(); assert.equal(view.state.open, true); } finally { view.close(); }
});

test("repeated Open clicks never turn the chat closed", () => {
  const view = opener();
  try { view.click(); view.click(); assert.equal(view.state.open, true); } finally { view.close(); }
});

test("flag Off retains the previous toggle during a stale-context window", () => {
  const view = opener({ enabled: false, open: true });
  try { view.click(); assert.equal(view.state.open, false); } finally { view.close(); }
});

test("the rollback flag is a small Everyone bugfix", () => {
  const definition = loader()("src/lib/flags/definitions/htpr-8030-chat-open-race.ts").default;
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
});
