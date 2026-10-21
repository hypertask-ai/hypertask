const assert = require("node:assert/strict");
const test = require("node:test");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

const flag = "htpr-7393-comment-inline-ai";
const oldFlag = "htpr-7337-edit-with-ai";
const keys = {
  HTPR_7393_COMMENT_INLINE_AI_FLAG: flag,
  HTPR_7337_EDIT_WITH_AI_FLAG: oldFlag,
  HTPR_6929_COMPOSE_TASK_WRITER_FLAG: "compose",
  HTPR_6937_NEW_TASK_WINDOW_FLAG: "new-task",
};
const modes = ["create-comment", "read-edit-comments", "read-edit-description"];
function harness(enabled, oldEnabled = true) {
  const actions = [];
  let writer = false;
  const mocks = {
    "@/hooks/useFlag": { useFlag: key => key === flag ? enabled : key === oldFlag ? oldEnabled : ["compose", "new-task"].includes(key) },
    "@/lib/flags/keys": keys,
    "@/lib/state": { useSetRecoilState: () => value => actions.push(["commands", value]), useRecoilValue: () => true },
    "@/store": { showCommandsAtom: "commands", showAIChatInterfaceAtom: "chat" },
    "@/models/enums": { CommandMode: { Command: "command" } },
    "@/hooks/MultiPages/AIChat/useCommentToAiChat": { useCommentToAiChat: () => ({ editTicketWithAi: id => actions.push(["chat", id]) }) },
    "@/utils/api/Task Detail": {},
    "./draftSync": {},
    "@/lib/tutorial/learnTutorialState": {},
    "@/lib/ai/autoDescriptionSuggestion": {},
    "@/lib/taskDetailInboxFlow": { resolveCommentEnterShortcutAction: () => null },
  };
  const context = mode => ({
    mode, currentTask: { id: 123 }, id: "test-editor", divIds: {}, editMode: "comment",
    cancelMobileExistingEditRef: {}, setShouldShowAITaskWriter: value => { writer = typeof value === "function" ? value(writer) : value; },
    setChatHandoffOpen: value => actions.push(["handoff", value]),
    editor: { commands: { blur: () => actions.push(["blur"]) } },
    shouldShowInlineDraftAiRef: {},
    setAiTriggerData: value => actions.push(["prompt", value]),
  });
  return { actions, mocks, context, writer: () => writer };
}
function runHook(fn, args) {
  const view = mount();
  let api;
  function Hook() { api = fn(...args); return null; }
  try { view.render(React.createElement(Hook)); return api; }
  finally { view.close(); }
}

test("comment AI buttons restore inline toggle, while flag off and descriptions retain sidebar handoff", () => {
  const previous = global.document;
  global.document = { getElementById: () => null };
  try {
    for (const enabled of [false, true]) for (const mode of modes) for (const mobile of [false, true]) {
      const h = harness(enabled);
      const context = { ...h.context(mode), mobileExistingEditOpen: mobile };
      const { useTaskDetailEditorSave } = loader(h.mocks)("src/components/RTE/useTaskDetailEditorSave.tsx");
      useTaskDetailEditorSave(() => context).toggleAiTaskWriter();
      const inline = enabled && mode !== "read-edit-description";
      assert.equal(h.writer(), inline, `${mode}, flag=${enabled}, mobile=${mobile}`);
      assert.deepEqual(h.actions, inline ? [] : [["blur"], ...(mobile ? [["handoff", true]] : []), ["chat", 123]]);
      if (inline) {
        useTaskDetailEditorSave(() => context).toggleAiTaskWriter();
        assert.equal(h.writer(), false, "second click closes the existing writer");
      }
    }
  } finally { global.document = previous; }
});

test("Ctrl+J stays inside comment editors only with the bugfix enabled", () => {
  for (const enabled of [false, true]) for (const mode of modes) for (const apple of [false, true]) {
    const h = harness(enabled);
    const context = { ...h.context(mode), isApple: apple, toggleAiTaskWriter: () => h.actions.push(["inline"]) };
    const { useTaskDetailEditorKeyboard } = loader(h.mocks)("src/components/RTE/useTaskDetailEditorKeyboard.tsx");
    let prevented = false;
    useTaskDetailEditorKeyboard(() => context).handleKeydown({ key: "j", keyCode: 74, ctrlKey: !apple, metaKey: apple, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.deepEqual(h.actions, enabled && mode !== "read-edit-description" ? [["inline"]] : [["commands", { show: true, mode: "command", paletteTab: "compose" }]]);
  }
});

test("targeted AI events deliver the prompt to comment writers instead of starting a sidebar session", () => {
  for (const enabled of [false, true]) for (const mode of modes) {
    const view = mount();
    const h = harness(enabled);
    const context = { ...h.context(mode), divIds: {}, shouldTriggerAiTaskWriter: false, suggestReplyAbortRef: {} };
    const { useTaskDetailEditorEvents } = loader({ ...h.mocks,
      "@/hooks/MultiPages/useClickOutside": { default: () => {} },
      "../PageComponents/TaskDetail/TopRow/CreateSummaryButton": { AI_TASK_WRITER_EVENT: "ai-trigger" },
      "./Components/EmojiGifPicker": { OPEN_EMOJI_GIF_PICKER_EVENT: "emoji" },
    })("src/components/RTE/useTaskDetailEditorEvents.tsx");
    function Hook() { useTaskDetailEditorEvents(context); return null; }
    try {
      view.render(React.createElement(Hook));
      window.dispatchEvent(new window.CustomEvent("ai-trigger", { detail: { targetId: "other", prompt: "ignore" } }));
      assert.equal(h.writer(), false);
      assert.deepEqual(h.actions, []);
      window.dispatchEvent(new window.CustomEvent("ai-trigger", { detail: { targetId: "test-editor", prompt: "rewrite this" } }));
      const inline = enabled && mode !== "read-edit-description";
      assert.equal(h.writer(), inline);
      assert.deepEqual(h.actions, inline ? [["prompt", { autoTrigger: true, initialPrompt: "rewrite this" }]] : [["chat", 123]]);
    } finally { view.close(); }
  }
});

const task = { id: 123, userId: 985, projectId: 7049, description_: { content: "body" } };
function stateMocks(h) {
  return { ...h.mocks,
    "@tanstack/react-query": { useQueryClient: () => ({}) },
    "@/lib/state": { useRecoilState: () => [{ id: 985 }, () => {}] },
    "@/hooks/General/useGetUserPreferences": { useGetUserPreferences: () => ({ data: {} }) },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "./Tiptap": { default: () => ({ editor: {} }) },
    "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => ({ parsedTask: JSON.stringify(task) }) },
    "next/navigation": { useRouter: () => ({}), useSearchParams: () => new URLSearchParams() },
    "@/lib/contexts/TaskDetail/DescriptionProvider": { useDescriptionAndCommentsContext: () => ({}) },
    "@/lib/taskDetailArchiveNavigation": { shouldAdvanceAfterNotificationArchive: () => false },
    "@/hooks/General/useMobileVisualViewport": { useMobileVisualViewport: () => null },
  };
}

test("an open comment writer remains visible, including when the sidebar flag is also on", () => {
  for (const enabled of [false, true]) for (const mode of modes) {
    const h = harness(enabled);
    const { useTaskDetailEditorState } = loader(stateMocks(h))("src/components/RTE/useTaskDetailEditorState.tsx");
    const state = runHook(useTaskDetailEditorState, [{ mode, shouldTriggerAiTaskWriter: true }]);
    assert.equal(state.shouldShowAiTaskWriter, enabled && mode !== "read-edit-description");
  }
});

test("hidden popover triggers and mobile handoff visibility follow the editor mode", () => {
  const Empty = () => null;
  for (const enabled of [false, true]) for (const mode of modes) {
    const h = harness(enabled);
    const { TaskDetailEditorPanels } = loader({ ...h.mocks,
      "react-dom": { createPortal: child => child },
      "next/dynamic": { default: () => Empty },
      "../PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/StaticDescriptionPlaceholder": { StaticDescriptionPlaceholderContext: React.createContext(null) },
      "@/lib/contexts/TaskDetail/TiptapProvider": { default: Empty },
      "./Components/TiptapBubbleMenu": { default: Empty },
      "./Components/TiptapMainContainer": { default: Empty },
      "../PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/InnerHtmlDescription": { default: Empty },
      "../PageComponents/TaskDetail/AI Task Writer/AITaskWriterContainer": { AITaskWriterWithProvider: Empty },
      "./Components/EmojiGifPicker": { default: Empty },
      "@/utils/undoActions/helperFuncs": { cn: () => "" },
      "@/lib/configs/taskDetail.config": { taskDetailSpacing: {} },
    })("src/components/RTE/TaskDetailEditorPanels.tsx");
    const context = { ...h.context(mode), toggleAiTaskWriter: () => h.actions.push(["toggle"]), getDefaultMode: () => "WriteWithAI", getBackgroundContent: () => "", inViewObject: {}, mobileExistingEditOpen: true, chatHandoffOpen: true };
    const element = runHook(TaskDetailEditorPanels, [context]);
    const children = element.props.children[0].props.children.props.children;
    const portal = children[2];
    assert.equal(portal.props.hidden, !(enabled && mode !== "read-edit-description"));
    children[3].props.onClick();
    assert.equal(h.writer(), enabled && mode !== "read-edit-description");
    assert.deepEqual(h.actions.filter(([name]) => name === "toggle"), enabled && mode !== "read-edit-description" ? [] : [["toggle"]]);
  }
});

function globalHook(h) {
  return loader({ ...h.mocks,
    "@/lib/state": { useRecoilState: atom => [atom === "user" ? { id: 985 } : {}, value => h.actions.push([atom, value])] },
    "@/store": { currentUserAtom: "user", showCommandsAtom: "commands" },
    "../MultiPages/Route/useHypertasksNavigate": { default: () => ({}) },
    "@/lib/constants/TaskDetail": { descriptionContainerId: "description-container" },
    "@/utils/helperFunctions/helperFunctions": {},
    "../General/useHasDrafts": { default: () => ({}) },
    "./useStarAndPin": { useStarAndPin: () => ({}) },
    "@tanstack/react-query": { useQueryClient: () => ({}) },
    "@/lib/constants": { default: {} },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@tanstack/react-virtual": { useVirtualizer: () => ({}), useWindowVirtualizer: () => ({}) },
    "./CommentAndDescriptionHooks/useUploadingStates": { default: () => ({}) },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "../General/useGetUserPreferences": { useGetUserPreferences: () => ({ data: {} }) },
    "@/utils/helperFunctions/TaskDetail": {},
    "@/lib/agentRuns/taskActivityFeed": { mergeTaskThreadFeed: () => [] },
    "@/lib/htc/isCommentCreatedByUser": { isCommentCreatedByUser: () => true },
    "@/hooks/General/useHydrated": { useHydrated: () => false },
  })("src/hooks/Task Detail/useTaskDetailGlobalStates.ts").default;
}

test("global comment shortcuts restore inline edit modes; description and flag-off keep current routing", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const enabled of [false, true]) for (const id of ["comment", "comment-0", "description-container"]) for (const refocus of [false, true]) {
    const view = mount();
    const h = harness(enabled);
    let api;
    function Hook() { api = globalHook(h)(task, '{"comments":[{"id":"456","creatorId":985}]}', {}, {}); return null; }
    try {
      view.render(React.createElement(Hook));
      const target = document.createElement("div");
      target.id = id; target.tabIndex = 0; document.body.append(target);
      if (!refocus) target.focus();
      React.act(() => refocus ? api.refocusAndOpenTaskWriter(id) : api.CTRL_J_ENTER_Handler(true));
      const inline = enabled && id !== "description-container";
      assert.deepEqual(h.actions.filter(([kind]) => kind === "chat" || kind === "commands"), inline ? [] : refocus ? [["chat", 123]] : [["commands", { show: true, mode: "command", paletteTab: "compose" }]]);
      if (inline) {
        React.act(() => t.mock.timers.tick(100));
        assert.equal(api.editMode, id === "comment" ? "new-comment-ai" : "edit-comment-ai");
        if (id === "comment-0") assert.equal(api.editState, 0);
      }
    } finally { view.close(); }
  }
});

test("bugfix definition releases to Everyone with a bounded rollback risk", () => {
  const definition = loader()(`src/lib/flags/definitions/${flag}.ts`).default;
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.shippedOn, "2026-10-20");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason);
});
