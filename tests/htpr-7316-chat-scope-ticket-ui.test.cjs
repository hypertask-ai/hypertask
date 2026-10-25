const assert = require("node:assert/strict");
const test = require("node:test");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");
const { load } = require("./task-route-loader.cjs");
const flag = "htpr-7316-chat-scope-ticket";
const chipFlag = "htpr-7053-compose-board-chip";
const noop = () => {};

function ui({ enabled = true, pathname = "/detail/project-15/42", taskId = 42, scope = null, mobile = false, reuseChip = true } = {}) {
  const atoms = Object.fromEntries(["currentProjectAtom", "currentUserAtom", "inViewObjectAtom", "dockedChatScopeAtom", "recentChatBoardIdsAtom", "aiChatExplicitOpenAtAtom", "fullScreenChatScopeAtom"].map((key) => [key, key]));
  const board = { id: 15, title: "Current board name" };
  let recent = [], state;
  const value = (atom) => atom === atoms.currentProjectAtom ? board : atom === atoms.currentUserAtom ? { id: 7 } : atom === atoms.inViewObjectAtom ? { taskId, taskTicketNumber: "HTPR-42", taskTitle: "Ticket title" } : null;
  const source = loader({
    "next/navigation": { usePathname: () => pathname },
    "@/hooks/useFlag": { useFlag: (key) => key === flag ? enabled : key === chipFlag && reuseChip },
    "@/lib/flags/keys": { HTPR_7316_CHAT_SCOPE_TICKET_FLAG: flag, HTPR_7053_COMPOSE_BOARD_CHIP_FLAG: chipFlag, HTPR_7734_AGENT_CHAT_CONTEXT_FLAG: "htpr-7734-agent-chat-context" },
    "@/store": atoms,
    "@/lib/state": {
      useRecoilValue: value,
      useRecoilState: (atom) => atom === atoms.dockedChatScopeAtom ? [scope, (next) => { scope = typeof next === "function" ? next(scope) : next; }] : atom === atoms.recentChatBoardIdsAtom ? [recent, (next) => { recent = next(recent); }] : [null, noop],
      useSetRecoilState: () => noop,
    },
    "@/hooks/MultiPages/useGetAllTeamsMinimal": { useGetAllTeamsMinimal: () => ({ data: [{ id: 1, title: "Pinned boards", projects: [{ id: 22, title: "Pinned board" }] }] }) },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(mobile) },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => ({ queuedMessages: [], contextList: [], editor: null, fileItems: [] }) },
    "@/lib/configs/aiTaskWriter.config": { aiTaskWriterConfig: { shortcutsAndTooltips: { ai_chat: { attachment_button: () => ({}), send_button: {}, cancel_stream_button: {}, add_context_button: {} } } } },
    "@tiptap/react": { EditorContent: () => null, useEditorState: ({ editor, selector }) => selector({ editor }) },
    "@/lib/controlledComposerEditor": { ControlledComposerEditor: () => null },
    "../Common/Tooltip": { default: () => null },
    "@/components/Modals/OptionPicker": { default: ({ options, onSelect }) => React.createElement("div", { role: "dialog" }, options.map((option) => React.createElement("button", { key: option.id ?? "current", "aria-checked": option.checked, onClick: () => onSelect(option) }, option.label))) },
    "../Global/ModelSelectorDropdown": { default: () => null },
    "../RTE/Components/AudioButton": { default: () => null },
    "../Common/AttachmentsUpload/ImageGalleryView": { default: () => null },
    "./AiChatComposerActionRow": { AiChatComposerActionRow: ({ leadingControls }) => mobile ? null : leadingControls },
    "./AttachmentButton": { AttachmentButton: () => null },
    "./AiComposerTextarea": { AiComposerTextarea: () => null },
    "./SendMessageButton": { SendMessageButton: () => null },
    "@/components/Common/QueuedMessagesStrip": { QueuedMessagesStrip: () => null },
    "@/hooks/MultiPages/AIChat/useSessionAndChatHistory": { useSessionAndChatHistory: () => ({ sessions: [] }) },
    "@/hooks/RecoilRoot/useHypertasksRecoilStates": { default: () => ({}) },
    "@/components/Modals/McpToken/hooks/useMcpToken": { useMcpToken: () => ({}) },
    "./useAiChatModelPreference": { useAiChatModelPreference: () => ({}) },
    "@tanstack/react-query": { useQueryClient: () => ({}) },
    "./aiChatShared": { aiOptionsWithoutOpenRouter: [] },
  });
  const { AI_Tiptap_Container } = source("src/components/AI_CHAT/AI_Tiptap_Container.tsx");
  const { useAiChatState } = source("src/hooks/MultiPages/AIChat/useAiChatState.ts");
  function Probe() {
    state = useAiChatState();
    return React.createElement(AI_Tiptap_Container);
  }
  const view = mount();
  const render = () => view.render(React.createElement(Probe));
  render();
  const trigger = () => view.container.querySelector('[aria-haspopup="dialog"]');
  const click = (element) => { assert.ok(element); React.act(() => element.click()); render(); };
  const rows = () => [...view.container.querySelectorAll('[role="dialog"] button')];
  return {
    ...view, render, trigger, click, rows, state: () => state, scope: () => scope, recent: () => recent,
    open: () => click(trigger()),
    pick: (label) => click(rows().find((row) => row.textContent === label)),
    navigate: (path, id) => { pathname = path; taskId = id; render(); },
    disable: () => { enabled = false; render(); },
  };
}

for (const mobile of [false, true]) {
  for (const reuseChip of [false, true]) {
    test(`existing ${mobile ? "mobile" : "desktop"} scope menu and chip choose the current ticket (shared chip: ${reuseChip})`, async () => {
      const h = ui({ mobile, reuseChip });
      try {
        assert.equal(h.scope(), null);
        assert.equal(h.trigger().textContent.includes("Current board name"), true);
        h.open();
        assert.deepEqual(h.rows().map((row) => row.textContent), ["Current ticket", "Current board", "All boards", "Pinned board"]);
        assert.equal(h.rows().find((row) => row.textContent === "Current board").getAttribute("aria-checked"), "true");
        h.pick("Current ticket");
        assert.equal(h.scope(), "ticket");
        assert.equal(h.trigger().textContent.includes("HTPR-42"), true);
        assert.equal(h.trigger().title, "Ticket title");
        assert.equal(h.state().ticketScopeSelected, true);
        const payload = await sendPayload(h.state());
        assert.equal(payload.default_context.scope, "ticket");
        assert.equal(payload.default_context.task_id, 42);
        assert.equal(payload.default_context.project_id, 15);
        h.open();
        assert.equal(h.rows()[0].getAttribute("aria-checked"), "true");
        h.pick("Current board");
        assert.equal(h.state().ticketScopeSelected, false);
        assert.equal((await sendPayload(h.state())).default_context.scope, undefined);
      } finally { h.close(); }
    });
  }
}

for (const options of [{ enabled: false }, { pathname: "/project-15", taskId: 42 }, { taskId: null }]) {
  test(`Current ticket stays hidden outside a flagged ticket view: ${JSON.stringify(options)}`, () => {
    const h = ui(options);
    try {
      h.open();
      assert.deepEqual(h.rows().map((row) => row.textContent), ["Current board", "All boards", "Pinned board"]);
    } finally { h.close(); }
  });
}

test("full-screen chat does not acquire a new composer scope dropdown", () => {
  const h = ui({ pathname: "/chat", taskId: undefined });
  try { assert.equal(h.trigger(), null); } finally { h.close(); }
});

for (const action of ["leave", "close", "flag off"]) {
  test(`ticket scope falls back to Current board on ${action}`, () => {
    const h = ui({ scope: "ticket" });
    try {
      assert.equal(h.state().ticketScopeSelected, true);
      const ticketKey = h.state().sessionContextKey;
      if (action === "flag off") h.disable();
      else h.navigate(action === "leave" ? "/project-15" : "/detail/project-15/42", null);
      assert.equal(h.scope(), null);
      assert.equal(h.state().ticketScopeSelected, false);
      assert.equal(h.state().scopedProjectId, 15);
      assert.notEqual(h.state().sessionContextKey, ticketKey);
    } finally { h.close(); }
  });
}

for (const [label, scope, projectId] of [["Current board", null, 15], ["Pinned board", 22, 22], ["All boards", "all", undefined]]) {
  test(`${label} selection and outgoing context remain unchanged`, async () => {
    const h = ui();
    try {
      h.open(); h.pick(label);
      assert.equal(h.scope(), scope);
      assert.equal(h.state().scopedProjectId, projectId);
      assert.equal(h.state().boardScopeIsExplicit, typeof scope === "number");
      const payload = await sendPayload(h.state());
      assert.equal(payload.default_context.project_id, projectId);
      assert.equal(payload.default_context.scope, undefined);
      if (typeof scope === "number") assert.deepEqual(h.recent(), [22]);
    } finally { h.close(); }
  });
}

async function sendPayload(state) {
  const originalFetch = global.fetch;
  const originalLog = console.log;
  let payload;
  global.fetch = async (_, options) => { payload = JSON.parse(options.body); return new Response("reply"); };
  console.log = noop;
  try {
    const { createAiChatSend } = load("src/hooks/MultiPages/AIChat/aiChatSend.ts", {
      "./aiChatStream": { consumeAiChatStream: async () => {} },
      "react-hot-toast": { default: { error: assert.fail } },
      "@/lib/mcp/bearerAuth": { mcpAuthorizationHeaders: () => ({}) },
      "@/lib/demo/guestBoardBuild": { isGuestBoardBuild: () => false },
    });
    let result;
    await React.act(async () => {
      result = await createAiChatSend({
        ...state,
        editor: { getHTML: () => "<p>Summarize this</p>", getText: () => "Summarize this", commands: { clearContent: noop } },
        fileUpload: { fileItems: [], clearFiles: noop },
        waitForChatSession: async () => ({ id: "session", messages: [] }),
        processAttachments: async () => [], addMessageToSessionQuery: noop,
        drainQueuedMessage: noop, handleSendMessageRef: { current: null },
        setAgentStatus: noop, appendMessageToSessionCache: assert.fail,
        chatRoute: "/api/ai/chat/stream", currentAiOption: { id: "model" },
      }).handleSendMessage();
    });
    assert.equal(result, true);
    assert.ok(payload);
    return payload;
  } finally { global.fetch = originalFetch; console.log = originalLog; }
}

for (const enabled of [false, true]) {
  for (const ticketScopeSelected of [false, true]) {
    test(`chat hook forwards ticket scope ${ticketScopeSelected} with flag ${enabled}`, () => {
      let sending;
      const { useAiChat } = load("src/hooks/MultiPages/AIChat/useAiChat.ts", {
        react: { useState: () => [0, noop], useEffect: noop },
        "@/hooks/useFlag": { useFlag: (key) => key === flag && enabled },
        "@/lib/state": { useRecoilState: () => [null, noop] },
        "@/store": {},
        "./useAiChatState": { useAiChatState: () => ({ ticketScopeSelected }) },
        "./useAiChatSessions": { useAiChatSessions: () => ({}) },
        "./useAiChatAttachments": { useAiChatAttachments: () => ({}) },
        "./aiChatSend": { createAiChatSend: (context) => { sending = context; return {}; } },
        "./aiChatKeyboard": { createAiChatKeyboard: () => ({}) },
        "./useAiChatPresentation": { useAiChatPresentation: () => ({}) },
      });
      useAiChat();
      assert.equal(sending.ticketScopeSelected, enabled && ticketScopeSelected);
    });
  }
}
