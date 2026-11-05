const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function load(file, mocks = {}) {
  const mod = { exports: {} };
  const compiled = ts.transpileModule(read(file), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function("require", "module", "exports", compiled)((name) => {
    if (Object.hasOwn(mocks, name)) return { __esModule: true, ...mocks[name] };
    if (name.startsWith("@/") || name.startsWith("./")) throw new Error(`Unstubbed dependency: ${name}`);
    return require(name);
  }, mod, mod.exports);
  return mod.exports;
}
const hookReact = { ...React, useMemo: (factory) => factory(), useRef: (value) => ({ current: value }), useEffect: (effect) => effect(), useState: (value) => [value, () => {}] };

const labels = [
  "Rewrite in plain words",
  "Shorten the title",
  "Add acceptance criteria",
  "Split into sub-tasks",
  "Turn the error log into steps to reproduce",
];

function summaryButton(comments, flaggedIncomplete = false) {
  const actions = [];
  const { default: Button } = load("src/components/PageComponents/TaskDetail/TopRow/CreateSummaryButton.tsx", {
    "@/hooks/useFlag": { useFlag: () => false },
    "@/lib/ai/chipEvents": { signalAiChip: () => {} },
    "@/lib/flags/definitions/htpr-8173-description-inline-drafts": { HTPR_8173_DESCRIPTION_INLINE_DRAFTS_FLAG: "htpr-8173-description-inline-drafts" },
    "@/lib/flags/definitions/htpr-8251-description-ai-edit": { HTPR_8251_DESCRIPTION_AI_EDIT_FLAG: "htpr-8251-description-ai-edit" },
    "@/components/Common/AIWriterButton": { default: () => null },
    "@/hooks/MultiPages/AIChat/useCommentToAiChat": { useCommentToAiChat: () => ({ editTicketWithAi: (id) => actions.push(["chat", id]) }) },
    "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => ({ currentTask: { id: 123, description_: { flaggedIncomplete } }, comments, setEditMode: (mode) => actions.push(["mode", mode]) }) },
  });
  return { element: Button(), actions };
}

test("Edit with AI shows on every ticket, including empty and unfinished ones, and opens the sidebar chat", () => {
  for (const [comments, flaggedIncomplete] of [[[{}], true], [[], false], [[{}], false]]) {
    const edit = summaryButton(comments, flaggedIncomplete);
    assert.match(renderToStaticMarkup(edit.element), /Edit with AI/);
    edit.element.props.children.props.onClick();
    assert.deepEqual(edit.actions, [["chat", 123]]);
  }
});

function welcome(editTaskId = 123) {
  const sent = [];
  const { WelcomeScreen } = load("src/components/AI_CHAT/WelcomeScreen.tsx", {
    react: hookReact,
    "@/hooks/useFlag": { useFlag: () => false },
    "@/lib/ai/chipEvents": { signalAiChip: () => {} },
    "@/lib/flags/keys": {},
    "@/hooks/General/useHydrated": { useHydrated: () => true },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => ({ isDetailPage: true, handleSendMessage: (message) => sent.push(message) }) },
    "next/navigation": { usePathname: () => "/detail/project-15/123" },
    "@tanstack/react-query": { useQuery: ({ queryKey }) => ({ data: queryKey[0] === "task-questions" ? { questions: ["Generated question"] } : [{ id: "old-thread", title: "Previous thread" }] }) },
    "@/lib/state": { useRecoilValue: (atom) => ({ task: { taskId: 123, taskTicketNumber: "HTPR-123" }, edit: editTaskId, ready: true })[atom] },
    "@/store": { composeTaskQuestionsTaskIdAtom: "questionsTaskId", inViewObjectAtom: "task", aiChatEditTaskIdAtom: "edit", taskDetailNonEssentialReadyAtom: "ready" },
    "@/lib/demo/isGuestClient": { isGuestCookieUser: () => false },
    "@/lib/demo/guestBoardBuild": { isGuestBoardBuild: () => false },
    "./GuestBoardSpotlight": { GuestBoardSpotlight: () => null },
    "@/utils/generateTime": { default: () => "now" },
    "./taskSummaryAction": { taskSummaryActionFor: () => ({ label: "Summarize the current task", prompt: "summary" }) },
    "@/lib/flags/definitions/htpr-8261-chat-cleanup": { HTPR_8261_CHAT_CLEANUP_FLAG: "htpr-8261-chat-cleanup" },
  });
  return { element: WelcomeScreen(), sent };
}
function buttons(element) {
  if (!element || typeof element !== "object") return [];
  return [ ...(element.type === "button" ? [element] : []), ...React.Children.toArray(element.props?.children).flatMap(buttons) ];
}

test("edit welcome uses exactly the five approved chips and sends in-place editing prompts naming the ticket", () => {
  const { element, sent } = welcome();
  assert.match(renderToStaticMarkup(element), /How do you want to edit this task\?/);
  const chips = buttons(element);
  assert.deepEqual(chips.map((button) => button.props.children), labels);
  for (const chip of chips) {
    assert.equal(chip.props.className, "bg-kanban-active-cardbg hover:bg-hover-active rounded p-2 text-xs text-left w-full");
    chip.props.onClick();
  }
  assert.equal(sent.length, labels.length);
  for (const prompt of sent) {
    assert.match(prompt, /HTPR-123/);
    assert.match(prompt, /update.*in place/i);
  }
  assert.match(sent[0], /description.*plain words/);
  assert.match(sent[1], /Shorten the title/);
  assert.match(sent[2], /acceptance criteria.*description/);
  assert.match(sent[3], /sub-tasks.*create them under this ticket/);
  assert.match(sent[4], /error log.*steps to reproduce.*description/);
});

test("a different viewed task or no task keeps today's generated questions, summary and threads", () => {
  for (const taskId of [999, null]) {
    const { element, sent } = welcome(taskId);
    const html = renderToStaticMarkup(element);
    assert.doesNotMatch(html, /How do you want to edit this task/);
    assert.match(html, /Generated question/);
    assert.match(html, /Summarize the current task/);
    assert.match(html, /Previous threads/);
    const question = buttons(element).find((button) => button.props.children === "Generated question");
    question.props.onClick();
    assert.deepEqual(sent, ["Generated question"]);
  }
});

test("opening edit mode opens the existing sidebar and starts a fresh session before setting edit context", async () => {
  const calls = [];
  let finish;
  const session = new Promise((resolve) => { finish = resolve; });
  const { useCommentToAiChat } = load("src/hooks/MultiPages/AIChat/useCommentToAiChat.ts", {
    react: hookReact,
    "@/lib/state": {
      useRecoilState: (atom) => [false, (value) => calls.push([atom, value])],
      useSetRecoilState: (atom) => (value) => calls.push([atom, value]),
      useRecoilValue: () => ({ taskId: 123 }),
    },
    "@/store": { showAIChatInterfaceAtom: "open", aiChatAutoOpenSuppressedAtom: "suppressed", aiChatExplicitOpenAtAtom: "focus", aiChatEditTaskIdAtom: "edit", isAiChatSidebarModeAtom: "sidebar" },
    "@/lib/contexts/Multipages/AI_Agent/chatContext": { useOptionalAiChatContext: () => ({ chatHistoryReady: true, startNewSession: () => { calls.push(["new-session"]); return session; }, restoreChat: () => calls.push(["restore"]), editor: { commands: { clearContent: () => calls.push(["clear-chat-composer"]) } } }) },
    "@/utils/helperFunctions/TaskDetail": { wrapBlockQuote: () => "" },
  });
  const opening = useCommentToAiChat().editTicketWithAi(123);
  await Promise.resolve();
  assert.ok(calls.some(([name, value]) => name === "open" && value === true));
  assert.ok(calls.some(([name, value]) => name === "sidebar" && value === true));
  assert.ok(calls.some(([name]) => name === "new-session"));
  assert.ok(!calls.some(([name, value]) => name === "edit" && value === 123));
  finish({ id: "fresh", messages: [] });
  await opening;
  assert.ok(calls.some(([name, value]) => name === "edit" && value === 123));
  assert.ok(!calls.some(([name]) => name === "clear-chat-composer"), "unsent chat text survives the handoff");
});

function editModeCleanup({ open = true, taskId = 123, messages = [] }) {
  const cleared = [];
  const { useAiChat } = load("src/hooks/MultiPages/AIChat/useAiChat.ts", {
    "@/hooks/MultiPages/Route/useHypertasksNavigate": { default: () => ({ navigateToTask() {} }) },
    react: hookReact,
    "@/hooks/useFlag": { useFlag: () => false },
    "@/lib/ai/chipEvents": { signalAiChip: () => {} },
    "@/lib/flags/keys": {},
    "@/lib/flags/definitions/htpr-7766-chat-shortcuts": { HTPR_7766_CHAT_SHORTCUTS_FLAG: "htpr-7766-chat-shortcuts" },
    "@/lib/flags/definitions/htpr-8812-chat-first-message": { HTPR_8812_CHAT_FIRST_MESSAGE_FLAG: "htpr-8812-chat-first-message" },
    "@/lib/flags/definitions/htpr-7683-ai-chat-ticket-rows": { HTPR_7683_AI_CHAT_TICKET_ROWS_FLAG: "htpr-7683-ai-chat-ticket-rows" },
    "@/lib/state": { useRecoilState: () => [123, (value) => cleared.push(value)] },
    "@/store": { aiChatEditTaskIdAtom: "edit" },
    "./useAiChatState": { useAiChatState: () => ({ showAiChatInterface: open, taskId, currentSession: { messages } }) },
    "./useAiChatSessions": { useAiChatSessions: () => ({}) },
    "./useAiChatAttachments": { useAiChatAttachments: () => ({ fileUpload: {} }) },
    "./aiChatSend": { createAiChatSend: () => ({}) },
    "./aiChatKeyboard": { createAiChatKeyboard: () => ({}) },
    "./useAiChatPresentation": { useAiChatPresentation: () => ({}) },
    "@/lib/flags/definitions/htpr-8334-multi-chat-windows": { HTPR_8334_MULTI_CHAT_WINDOWS_FLAG: "htpr-8334-multi-chat-windows" },
  });
  useAiChat();
  return cleared;
}

test("edit mode clears after typed or chip messages, close, or task navigation", () => {
  assert.deepEqual(editModeCleanup({}), []);
  for (const state of [{ messages: [{ role: "human", content: "typed message" }] }, { open: false }, { taskId: 999 }, { taskId: null }]) {
    assert.deepEqual(editModeCleanup(state), [null]);
  }
});

test("Ctrl+J opens the new-ticket composer", () => {
  const { taskDetailNavigationKeymap } = load("src/app/detail/[...slug]/taskDetailNavigationKeymap.ts", {
    "@/lib/configs/taskDetail.config": { default: {} },
    "@/lib/keyboard/archiveShortcutGuard": {},
    "@/lib/taskDetailArchiveNavigation": {},
    "@/models/enums": { CommandMode: { Command: "command" } },
    "@/lib/constants/keyboard-handler": { KeyCodes: { J: 74 } },
  });
  const previousDocument = global.document;
  global.document = { getElementById: () => null };
  try {
    const actions = [];
    const keymap = taskDetailNavigationKeymap({ currentTask: { id: 123 },
      setShowCommands: (value) => actions.push(value),
    }, { keyCode: 74, preventDefault: () => {} }, true);
    const command = keymap.find((item) => item.action === "aiWriter");
    assert.equal(command.matches(), true);
    assert.equal(command.run().stop, true);
    assert.deepEqual(actions, [{ show: true, mode: "command", paletteTab: "compose" }]);
  } finally {
    global.document = previousDocument;
  }
});

test("edit action waits for a lazy chat runtime and ignores close/navigation during session creation", async () => {
  const { JSDOM } = require("jsdom");
  const { createRoot } = require("react-dom/client");
  const dom = new JSDOM("<div id='root'></div>");
  const previous = { window: global.window, document: global.document, act: global.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const reactRoot = createRoot(document.getElementById("root"));
  let runtime, api, taskId = 123;
  const values = { open: false, edit: null };
  const { useCommentToAiChat } = load("src/hooks/MultiPages/AIChat/useCommentToAiChat.ts", {
    "@/lib/state": {
      useRecoilState: (atom) => [values[atom], (value) => { values[atom] = value; }],
      useSetRecoilState: (atom) => (value) => { values[atom] = value; },
      useRecoilValue: () => ({ taskId }),
    },
    "@/store": { showAIChatInterfaceAtom: "open", aiChatEditTaskIdAtom: "edit" },
    "@/lib/contexts/Multipages/AI_Agent/chatContext": { useOptionalAiChatContext: () => runtime },
    "@/utils/helperFunctions/TaskDetail": {},
  });
  function Hook() { api = useCommentToAiChat(); return null; }
  const render = () => React.act(async () => reactRoot.render(React.createElement(Hook)));
  try {
    for (const cancel of [null, "close", "navigate", "failed-session"]) {
      runtime = undefined;
      taskId = 123;
      values.edit = null;
      await render();
      const opening = api.editTicketWithAi(123);
      assert.equal(values.open, true, "opening the chat must load its runtime even when context is missing");
      let finish, started;
      const session = new Promise((resolve) => { finish = resolve; });
      const creationStarted = new Promise((resolve) => { started = resolve; });
      runtime = { chatHistoryReady: true, startNewSession: () => { started(); return session; } };
      await render();
      await creationStarted;
      assert.equal(values.edit, null);
      if (cancel === "close") values.open = false;
      if (cancel === "navigate") taskId = 999;
      await render();
      finish(cancel === "failed-session" ? undefined : { id: "new-session", messages: [] });
      await opening;
      assert.equal(values.edit, cancel ? null : 123);
    }
  } finally {
    await React.act(async () => reactRoot.unmount());
    Object.assign(global, { window: previous.window, document: previous.document, IS_REACT_ACT_ENVIRONMENT: previous.act });
    dom.window.close();
  }
});
