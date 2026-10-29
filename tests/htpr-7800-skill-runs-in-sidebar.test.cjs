const assert = require("node:assert/strict");
const test = require("node:test");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

const flag = "htpr-7800-skill-runs-in-sidebar";
const flagImport = "@/lib/flags/definitions/htpr-7800-skill-runs-in-sidebar";
const noop = () => {};

async function pickSkill({ enabled = true, mode = "create-comment", keyboard = false, external = false, prompt = "/deeper " } = {}) {
  const view = mount();
  const previousFetch = global.fetch;
  const Chat = React.createContext(null);
  const writes = [];
  const sent = [];
  let writer = false;
  let content = "Before /dee after\nSecond paragraph";
  let sessionCount = 0;
  let nativeTarget = null;
  const editor = {
    storage: { slashCommands: { mode, editorId: "comment-editor" } },
    getText: () => content,
    chain: () => ({
      focus() { return this; },
      deleteRange() { content = content.replace("/dee", ""); return this; },
      run() { return true; },
    }),
  };
  const keys = {
    HTPR_7480_COMMENT_SKILL_RUN_FLAG: "comment-skills",
    HTPR_7393_COMMENT_INLINE_AI_FLAG: "inline-ai",
    HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG: "agent-chats",
  };
  const agent = { id: "runner", displayName: "Runner", runtimeType: "EXTERNAL" };
  const mocks = {
    [flagImport]: { HTPR_7800_SKILL_RUNS_IN_SIDEBAR_FLAG: flag },
    "@/lib/flags/definitions/htpr-7766-chat-shortcuts": { HTPR_7766_CHAT_SHORTCUTS_FLAG: "htpr-7766-chat-shortcuts" },
    "@/hooks/MultiPages/AIChat/useChatShortcuts": { useChatShortcuts: () => ({ enabled: false }) },
    "@/hooks/useFlag": { useFlag: key => key === flag ? enabled : ["comment-skills", "inline-ai", "agent-chats"].includes(key) },
    "@/lib/flags/keys": keys,
    "@/lib/flags/definitions/htpr-7688-past-chats-first": { HTPR_7688_PAST_CHATS_FIRST_FLAG: "past-chats" },
    "@/lib/flags/definitions/htpr-7318-ticket-chat-reminder": { HTPR_7318_TICKET_CHAT_REMINDER_FLAG: "reminder-off" },
    "@/lib/state": {
      useRecoilState: atom => {
        const [value, setValue] = React.useState(atom === "width" ? 320 : atom === "project" ? { id: 15 } : false);
        return [value, next => { writes.push([atom, next]); setValue(next); }];
      },
      useRecoilValue: atom => ({ task: { taskId: 123 }, project: { id: 15 }, user: { id: 985 } })[atom],
      useSetRecoilState: atom => value => writes.push([atom, value]),
    },
    "@/store": {
      currentProjectAtom: "project", currentUserAtom: "user", aiChatSidebarWidthPxAtom: "width",
      showAIChatInterfaceAtom: "open", aiChatAutoOpenSuppressedAtom: "suppressed", aiChatExplicitOpenAtAtom: "focus",
      aiChatEditTaskIdAtom: "edit", inViewObjectAtom: "task", isAiChatSidebarModeAtom: "docked", showCommandsAtom: "commands",
    },
    "@/lib/contexts/Multipages/AI_Agent/chatContext": { useOptionalAiChatContext: () => React.useContext(Chat) },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => React.useContext(Chat) },
    "@/utils/helperFunctions/TaskDetail": { wrapBlockQuote: text => text },
    "@/models/enums": { CommandMode: {} },
    "@/hooks/MultiPages/useClickOutside": { default: noop },
    "./Components/EmojiGifPicker": { OPEN_EMOJI_GIF_PICKER_EVENT: "emoji" },
    "../PageComponents/TaskDetail/TopRow/CreateSummaryButton": { AI_TASK_WRITER_EVENT: "skill-writer" },
    "@/components/PageComponents/TaskDetail/TopRow/CreateSummaryButton": { AI_TASK_WRITER_EVENT: "skill-writer" },
    "@/assets/AILogo.png": { default: { src: "ai.png" } },
    "@/lib/skills/slashSkills": {
      ...loader()("src/lib/skills/slashSkills.ts"),
      fetchSlashSkills: async () => [{ slug: "deeper", name: "Deeper", isProject: true }],
    },
    "@/app/agents/chat/AgentChatClient": { default: () => React.createElement("div", { "data-external": true }, "Agent chat") },
    "@/lib/agents/chatDrafts": { readDraft: () => "", writeDraft: noop },
    "@/lib/agents/chatViewerState": { getNativeSidebarChat: () => nativeTarget, setNativeSidebarChat: value => { nativeTarget = value; } },
    "@/utils/api/ai_chat/aiChatHelpers": { AI_Chat_API: {} },
    "next/navigation": { useSearchParams: () => new URLSearchParams() },
    "@tanstack/react-query": { useQueryClient: () => ({ invalidateQueries: async () => {} }) },
    "./MessageList": { MessageList: () => React.createElement("div", { "data-result": true }, React.useContext(Chat).result) },
    "./WelcomeScreen": { WelcomeScreen: () => null },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "./ChatHeader": { ChatHeader: ({ sidebarChats }) => React.createElement("button", { "data-agent": true, onClick: () => sidebarChats.onSelect({ kind: "external-agent", agent }) }, sidebarChats.target.kind) },
    "./AI_Tiptap_Container": { AI_Tiptap_Container: () => null },
    "./AiChatSidebarResizeHandle": { AiChatSidebarResizeHandle: () => null },
    "@/lib/configs/style.config": { AI_CHAT_SIDEBAR_MIN_PX: 320 },
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.flat().filter(Boolean).join(" ") },
  };
  const load = loader(mocks);
  const { useCommentToAiChat } = load("src/hooks/MultiPages/AIChat/useCommentToAiChat.ts");
  mocks["@/hooks/MultiPages/AIChat/useCommentToAiChat"] = { useCommentToAiChat };
  const { useTaskDetailEditorEvents } = load("src/components/RTE/useTaskDetailEditorEvents.tsx");
  const CommandsList = load("src/components/RTE/Extensions/SlashCommands/CommandsList.tsx").default;
  const { AI_Chat_Sidebar } = load("src/components/AI_CHAT/AI_Chat_Sidebar.tsx");
  const ref = React.createRef();
  const finished = Promise.withResolvers();
  function Events() {
    useTaskDetailEditorEvents({
      mode, id: "comment-editor", editor, currentTask: { id: 123 }, divIds: {}, suggestReplyAbortRef: {},
      setShouldShowAITaskWriter: value => { writer = value; }, setAiTriggerData: noop,
    });
    return null;
  }
  function Harness() {
    const [session, setSession] = React.useState({ id: "old-session", messages: [] });
    const [result, setResult] = React.useState("");
    const chat = {
      currentSession: session, fileItems: [], chatHistoryReady: true, isTyping: false, result,
      editor: { getHTML: () => "", getText: () => "", commands: { setContent: noop } }, resetFiles: noop,
      startNewSession: async () => { const next = { id: `skill-${++sessionCount}`, messages: [] }; setSession(next); return next; },
      selectSession: id => setSession({ id, messages: [] }), restoreChat: noop,
      handleSendMessage: async text => { sent.push({ sessionId: session.id, text }); setResult("Deeper result"); finished.resolve(); return true; },
    };
    return React.createElement(Chat.Provider, { value: chat }, React.createElement(Events),
      React.createElement(CommandsList, { ref, editor, range: { from: 8, to: 12 }, query: "", items: [], command: assert.fail }),
      React.createElement(AI_Chat_Sidebar));
  }
  try {
    global.fetch = async () => ({ ok: true, json: async () => ({ success: true, agents: [agent] }) });
    await React.act(async () => view.render(React.createElement(Harness)));
    if (external) await React.act(async () => view.container.querySelector("[data-agent]").click());
    await React.act(async () => {
      if (prompt !== "/deeper ") window.dispatchEvent(new window.CustomEvent("skill-writer", { detail: { targetId: "comment-editor", prompt } }));
      else if (keyboard) ref.current.onKeyDown({ event: { key: "Enter" } });
      else view.container.querySelector("li").dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    });
    if (enabled && prompt === "/deeper ") {
      await React.act(async () => { await Promise.race([finished.promise, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("Skill did not reach chat")), 2000); timer.unref(); })]); });
      assert.equal(view.container.querySelector("[data-agent]").textContent, "ai");
      assert.equal(view.container.querySelector("[data-result]").textContent, "Deeper result");
    }
    return { writer, content, sent, sessionCount, opened: writes.some(([atom, value]) => atom === "open" && value === true), docked: writes.some(([atom, value]) => atom === "docked" && value === true) };
  } finally { global.fetch = previousFetch; view.close(); }
}

test("comment skill mouse and keyboard picks run in a fresh docked AI chat without the purple writer or losing the draft", async () => {
  for (const mode of ["create-comment", "read-edit-comments"]) for (const keyboard of [false, true]) {
    assert.deepEqual(await pickSkill({ mode, keyboard, external: true }), {
      writer: false, content: "Before  after\nSecond paragraph", sessionCount: 1, opened: true, docked: true,
      sent: [{ sessionId: "skill-1", text: "/deeper\n\nBefore  after\nSecond paragraph" }],
    });
  }
});

test("flag off preserves the purple skill writer and ordinary comment AI prompts keep their existing writer", async () => {
  const off = await pickSkill({ enabled: false });
  assert.equal(off.writer, true);
  assert.equal(off.content, "Before  after\nSecond paragraph");
  assert.deepEqual(off.sent, []);
  assert.equal(off.sessionCount, 0);
  const ordinary = await pickSkill({ prompt: "Rewrite my comment" });
  assert.equal(ordinary.writer, true);
  assert.equal(ordinary.content, "Before /dee after\nSecond paragraph");
  assert.deepEqual(ordinary.sent, []);
  assert.equal(ordinary.sessionCount, 0);
});

test("chat context includes full ticket description and comments and resolves the selected skill for this board", async () => {
  const description = "<p>Full description</p>".repeat(1000);
  const { loadCurrentTaskContext } = loader({
    "@/lib/prisma": { default: { task: { findMany: async query => {
      assert.deepEqual(query.where.id, { in: [123] });
      return [{ id: 123, ticketNumber: "HTPR-123", title: "Ticket title", description_: { content: description },
        comments: [{ text: "Existing comment", creator: { displayName: "Author" }, createdAt: new Date() }] }];
    } } } },
    "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: () => ({}) },
    "@/lib/mcp/webhooks/ssrfGuard": {},
  })("src/app/api/ai/_lib/currentTaskContext.ts");
  const context = await loadCurrentTaskContext([123], 985, undefined, { projectId: 15 });
  assert.ok(context.includes(description));
  assert.match(context, /Title: Ticket title/);
  assert.match(context, /Author: Existing comment/);
  const { resolveSkills } = loader({ "./skillAccess": { AccountSkillAccessError: class extends Error {} } })("src/app/api/ai/_lib/skills.ts");
  const resolved = await resolveSkills("/deeper\n\nBefore  after", { userId: 985, projectId: 15 }, async () => [
    { id: 1, slug: "deeper", name: "Deeper", body: "Explore the ticket carefully", projectId: 15, userId: null },
  ]);
  assert.match(resolved.systemPromptAddition, /Explore the ticket carefully/);
  assert.match(resolved.cleanedText, /Before  after/);
});

test("feature is immediately available to Everyone and can be rolled back independently", () => {
  const definition = loader()(`src/lib/flags/definitions/${flag}.ts`).default;
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
});
