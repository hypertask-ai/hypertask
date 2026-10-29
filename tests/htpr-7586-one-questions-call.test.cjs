const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const flag = "htpr-7586-one-questions-call";
const composeFlag = "htpr-6929-compose-task-writer";
const questionsFlag = "htpr-7317-ctrlj-ticket-questions";
const intro = { taskId: 43, content: "I created QASA-43 from your note. Want me to refine it?" };
const newQuestions = ["Which boards get the sidebar first?", "Add steps for the empty sidebar"];
const genericQuestions = ["What is blocking this ticket?", "Who should take the next step?"];

function load(file, mocks) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    if (Object.hasOwn(mocks, name)) return { __esModule: true, ...mocks[name] };
    if (name.startsWith("@/") || name.startsWith("./")) throw new Error(`Unstubbed dependency: ${name}`);
    return require(name);
  }, mod, mod.exports);
  return mod.exports;
}

async function withSidebar(options, check) {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://app.hypertask.ai/detail/project-6859/43" });
  const previous = ["window", "document", "fetch", "IS_REACT_ACT_ENVIRONMENT"].map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]);
  Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const requests = [];
  const sent = [];
  let pendingIntro = options.pendingIntro ?? null;
  let questionsTaskId = options.questionsTaskId ?? null;
  let dataReady = options.dataReady ?? true;
  let session = { id: "s1", taskId: 43, messages: [] };
  const flags = new Set([composeFlag, questionsFlag, flag]);
  for (const disabled of options.disabledFlags ?? []) flags.delete(disabled);
  const atoms = {
    currentProjectAtom: "project", inViewObjectAtom: "task", taskDetailNonEssentialReadyAtom: "ready",
    aiChatEditTaskIdAtom: "edit", composeTaskChatIntroAtom: "intro", composeTaskQuestionsTaskIdAtom: "questionsTaskId", aiChatSidebarWidthPxAtom: "width",
  };
  const mocks = {
    "@/lib/flags/definitions/htpr-7766-chat-shortcuts": { HTPR_7766_CHAT_SHORTCUTS_FLAG: "htpr-7766-chat-shortcuts" },
    "@/hooks/MultiPages/AIChat/useChatShortcuts": { useChatShortcuts: () => ({ enabled: false }) },
    "@/hooks/useFlag": { useFlag: (key) => flags.has(key) },
    "@/lib/ai/chipEvents": { signalAiChip: () => {} },
    "@/lib/flags/keys": {
      HTPR_7586_ONE_QUESTIONS_CALL_FLAG: flag,
      HTPR_6929_COMPOSE_TASK_WRITER_FLAG: composeFlag,
      HTPR_7317_CTRLJ_TICKET_QUESTIONS_FLAG: questionsFlag,
      HTPR_7337_EDIT_WITH_AI_FLAG: "htpr-7337-edit-with-ai",
    },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": {
      useAiChatContext: () => ({
        isDetailPage: true, currentSession: session, showWelcomeScreen: session.messages.length === 0,
        chatMounted: true, minimized: false, isTyping: false,
        handleMessageListScroll: () => {}, registerMessageListRef: () => {}, scrollMessagesToBottom: () => {},
        handleSendMessage: (message) => sent.push(message), selectSession: () => {},
      }),
    },
    "next/navigation": { usePathname: () => "/detail/project-6859/43" },
    "@/lib/state": {
      useRecoilValue: (atom) => ({ task: { taskId: 43, taskTicketNumber: "QASA-43" }, ready: dataReady, intro: pendingIntro, questionsTaskId })[atom] ?? null,
      useSetRecoilState: (atom) => (value) => {
        assert.equal(atom, atoms.composeTaskQuestionsTaskIdAtom);
        questionsTaskId = value;
      },
      useRecoilState: () => [360, () => {}],
    },
    "@/store": atoms,
    "@/lib/demo/isGuestClient": { isGuestCookieUser: () => false },
    "@/lib/demo/guestBoardBuild": { isGuestBoardBuild: () => false },
    "./GuestBoardSpotlight": { GuestBoardSpotlight: () => null },
    "@/utils/generateTime": { default: () => "now" },
    "./taskSummaryAction": { taskSummaryActionFor: () => ({ label: "Summarize the current task", prompt: "/i Summarize the current task" }) },
    "@/hooks/General/useHydrated": { useHydrated: () => true },
    "./MessageItem": { MessageItem: ({ message }) => React.createElement("div", null, message.content) },
    "./TypingIndicator": { TypingIndicator: () => React.createElement("span", null, "Loading") },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "./ChatHeader": { ChatHeader: () => null },
    "./AI_Tiptap_Container": { AI_Tiptap_Container: () => null },
    "./AiChatSidebarResizeHandle": { AiChatSidebarResizeHandle: () => null },
    "@/lib/configs/style.config": { AI_CHAT_SIDEBAR_MIN_PX: 320 },
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.flat().filter(Boolean).join(" ") },
  };
  let reactRoot;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  try {
    const { WelcomeScreen } = load("src/components/AI_CHAT/WelcomeScreen.tsx", mocks);
    const { MessageList } = load("src/components/AI_CHAT/MessageList.tsx", mocks);
    const { AI_Chat_Sidebar } = load("src/components/AI_CHAT/AI_Chat_Sidebar.tsx", {
      ...mocks, "./WelcomeScreen": { WelcomeScreen }, "./MessageList": { MessageList },
      "@/app/agents/chat/AgentChatClient": { default: () => null },
      "@/lib/flags/definitions/htpr-8048-agent-sessions": { HTPR_8048_AGENT_SESSIONS_FLAG: "htpr-8048-agent-sessions" },
      "@/lib/flags/definitions/htpr-7737-agent-hover-chat": { HTPR_7737_AGENT_HOVER_CHAT_FLAG: "htpr-7737-agent-hover-chat" },
      "@/lib/flags/definitions/htpr-7800-skill-runs-in-sidebar": { HTPR_7800_SKILL_RUNS_IN_SIDEBAR_FLAG: "htpr-7800-skill-runs-in-sidebar" },
      "@/lib/flags/definitions/htpr-7688-past-chats-first": { HTPR_7688_PAST_CHATS_FIRST_FLAG: "htpr-7688-past-chats-first" },
      "@/lib/flags/definitions/htpr-7318-ticket-chat-reminder": { HTPR_7318_TICKET_CHAT_REMINDER_FLAG: "htpr-7318-ticket-chat-reminder" },
      "@/lib/agents/chatDrafts": { readDraft: () => "", writeDraft: () => {} },
      "@/lib/agents/chatViewerState": { getNativeSidebarChat: () => null, setNativeSidebarChat: () => {} },
      "@/utils/api/ai_chat/aiChatHelpers": { AI_Chat_API: {} },
      "@/store": { ...atoms, currentUserAtom: "user" },
      "next/navigation": { useSearchParams: () => new URLSearchParams() },
      "@tanstack/react-query": { useQueryClient: () => ({ invalidateQueries: async () => {} }) },
    });
    global.fetch = async (url, init) => {
      if (url === "/api/ai/task-questions") {
        const body = JSON.parse(init.body);
        requests.push({ url, method: init.method, credentials: init.credentials, body });
        return { ok: true, json: async () => ({ questions: body.kind === "new-ticket" ? newQuestions : genericQuestions }) };
      }
      assert.equal(url, "/api/ai-chat/task-sessions?taskId=43");
      return { ok: true, json: async () => ({ sessions: [] }) };
    };
    reactRoot = createRoot(document.getElementById("root"));
    const render = async () => {
      await React.act(async () => reactRoot.render(React.createElement(QueryClientProvider, { client }, React.createElement(AI_Chat_Sidebar))));
      await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    };
    await render();
    await check({
      requests, sent, client,
      get pendingIntro() { return pendingIntro; },
      get questionsTaskId() { return questionsTaskId; },
      clearIntro: async () => { pendingIntro = null; await render(); },
      ready: async () => { dataReady = true; await render(); },
      newChat: async () => { session = { ...session, id: "s2", messages: [] }; await render(); },
      deliverIntro: async () => {
        session = { ...session, messages: [{ id: "persisted-intro", role: "assistant", content: intro.content }] };
        pendingIntro = null;
        await render();
      },
      render,
    });
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    client.clear();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
    dom.window.close();
  }
}

const request = (body) => ({ url: "/api/ai/task-questions", method: "POST", credentials: "include", body });
const chipTexts = () => [...document.querySelectorAll("[data-compose-question]")].map((chip) => chip.textContent);

for (const enabled of [true, false]) {
  test(`Ctrl+J welcome-to-intro transition makes ${enabled ? "one new-ticket request" : "today's two requests with the bugfix off"} and keeps the same chips`, async () => {
    await withSidebar({ pendingIntro: intro, questionsTaskId: 43, dataReady: false, disabledFlags: enabled ? [] : [flag] }, async (view) => {
      assert.deepEqual(view.requests, []);
      await view.clearIntro();
      assert.equal(view.pendingIntro, null);
      assert.equal(view.questionsTaskId, 43);
      await view.ready();
      assert.deepEqual(view.requests, enabled ? [] : [request({ taskId: 43 })]);
      assert.match(document.body.textContent, /Summarize the current task/);
      if (enabled) assert.equal(view.client.getQueryState(["task-questions", 43]).fetchStatus, "idle");
      await view.deliverIntro();
      assert.equal(view.questionsTaskId, null);
      assert.deepEqual(view.requests, [
        ...(enabled ? [] : [request({ taskId: 43 })]),
        request({ taskId: 43, kind: "new-ticket" }),
      ]);
      assert.match(document.body.textContent, /I created QASA-43 from your note/);
      assert.match(document.body.textContent, /Questions and ideas for this ticket/);
      assert.deepEqual(chipTexts(), newQuestions);
      for (const question of genericQuestions) assert.equal(document.body.textContent.includes(question), false);
      await React.act(async () => document.querySelectorAll("[data-compose-question]")[1].click());
      assert.deepEqual(view.sent, ["Add steps for the empty sidebar"]);
      await view.render();
      assert.equal(view.requests.length, enabled ? 1 : 2);
    });
  });
}

for (const questionsTaskId of [null, 99]) {
  test(`existing ticket with marker ${questionsTaskId} still fetches generic questions once and renders actionable questions and Ask all`, async () => {
    await withSidebar({ questionsTaskId }, async (view) => {
      assert.deepEqual(view.requests, [request({ taskId: 43 })]);
      assert.deepEqual(chipTexts(), []);
      const buttons = [...document.querySelectorAll("button")];
      for (const question of genericQuestions) assert.ok(buttons.some((button) => button.textContent === question));
      const askAll = buttons.find((button) => button.textContent === "Ask all");
      assert.ok(askAll);
      await React.act(async () => buttons.find((button) => button.textContent === genericQuestions[0]).click());
      await React.act(async () => askAll.click());
      assert.deepEqual(view.sent, [
        "What is blocking this ticket?",
        "Answer each of these about this ticket:\n1. What is blocking this ticket?\n2. Who should take the next step?",
      ]);
      await view.render();
      assert.deepEqual(view.requests, [request({ taskId: 43 })]);
    });
  });
}

test("MessageList releases the marker so a later new chat fetches generic questions", async () => {
  await withSidebar({ questionsTaskId: 43 }, async (view) => {
    assert.deepEqual(view.requests, []);
    await view.deliverIntro();
    assert.equal(view.questionsTaskId, null);
    assert.deepEqual(view.requests, [request({ taskId: 43, kind: "new-ticket" })]);
    await view.newChat();
    assert.deepEqual(view.requests, [request({ taskId: 43, kind: "new-ticket" }), request({ taskId: 43 })]);
    for (const question of genericQuestions) assert.ok(document.body.textContent.includes(question));
    assert.deepEqual(chipTexts(), []);
  });
});

test("MessageList leaves another task's marker intact", async () => {
  await withSidebar({ questionsTaskId: 99 }, async (view) => {
    await view.deliverIntro();
    assert.equal(view.questionsTaskId, 99);
    assert.deepEqual(chipTexts(), newQuestions);
  });
});

test("unrelated or non-question intros and disabled source flags do not suppress generic questions", async () => {
  for (const options of [
    { pendingIntro: { ...intro, taskId: 99 } },
    { pendingIntro: { ...intro, content: "I created 2 tickets from your note." } },
    { pendingIntro: intro, disabledFlags: [questionsFlag] },
    { pendingIntro: intro, disabledFlags: [composeFlag] },
  ]) {
    await withSidebar(options, async (view) => {
      assert.deepEqual(view.requests, [request({ taskId: 43 })]);
      for (const question of genericQuestions) assert.ok(document.body.textContent.includes(question));
    });
  }
});

test("bugfix flag defaults to Everyone and is exported through the generated registry", () => {
  const jiti = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, cache: false, interopDefault: true });
  const definition = jiti(path.join(root, `src/lib/flags/definitions/${flag}.ts`));
  const keys = jiti(path.join(root, "src/lib/flags/keys.ts"));
  const { FEATURE_FLAG_DEFINITIONS } = jiti(path.join(root, "src/lib/flags/definitions.ts"));
  const value = definition.default ?? definition;
  assert.equal(value.key, flag);
  assert.equal(value.kind, "bugfix");
  assert.equal(value.defaultMode, "EVERYONE");
  assert.equal(value.shippedOn, "2026-10-22");
  assert.deepEqual(value.related, [questionsFlag]);
  assert.equal(value.releaseRisk.risk, "small");
  assert.ok(value.releaseRisk.reason.trim());
  assert.equal(keys.HTPR_7586_ONE_QUESTIONS_CALL_FLAG, flag);
  assert.deepEqual(FEATURE_FLAG_DEFINITIONS.find(({ key }) => key === flag), value);
});
