const assert = require("node:assert/strict");
const test = require("node:test");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

const flag = "htpr-8173-description-inline-drafts";
const oldFlag = "htpr-7337-edit-with-ai";
const commentFlag = "htpr-7393-comment-inline-ai";
const keys = {
  HTPR_7337_EDIT_WITH_AI_FLAG: oldFlag,
  HTPR_7393_COMMENT_INLINE_AI_FLAG: commentFlag,
  HTPR_6929_COMPOSE_TASK_WRITER_FLAG: "compose",
  HTPR_6937_NEW_TASK_WINDOW_FLAG: "new-task",
};
function harness(enabled, commentInline = false) {
  const actions = [];
  let writer = false;
  const mocks = {
    "@/hooks/useFlag": { useFlag: key => key === flag ? enabled : key === commentFlag ? commentInline : [oldFlag, "compose", "new-task"].includes(key) },
    "@/lib/flags/keys": keys,
    "@/lib/state": { useSetRecoilState: () => value => actions.push(["commands", value]) },
    "@/store": { showCommandsAtom: "commands" },
    "@/models/enums": { CommandMode: { Command: "command" } },
    "@/hooks/MultiPages/AIChat/useCommentToAiChat": { useCommentToAiChat: () => ({ editTicketWithAi: id => actions.push(["chat", id]) }) },
    "@/utils/api/Task Detail": { cancelPendingDraftUpdates: () => {} },
    "./draftSync": {},
    "@/lib/tutorial/learnTutorialState": {},
    "@/lib/ai/autoDescriptionSuggestion": {},
    "@/lib/taskDetailInboxFlow": { resolveCommentEnterShortcutAction: () => null },
  };
  const context = mode => ({
    mode, currentTask: { id: 123 }, id: "description", divIds: {}, editMode: "description-ai",
    cancelMobileExistingEditRef: {}, setShouldShowAITaskWriter: value => { writer = typeof value === "function" ? value(writer) : value; },
    setChatHandoffOpen: value => actions.push(["handoff", value]),
    editor: { commands: { blur: () => actions.push(["blur"]) } },
    shouldShowInlineDraftAiRef: {}, setAiTriggerData: value => actions.push(["prompt", value]),
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

test("button opens description editor without generating or opening chat", () => {
  for (const enabled of [false, true]) {
    const h = harness(enabled);
    const { default: Button } = loader({ ...h.mocks,
      "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => ({ currentTask: { id: 123 }, comments: [], setEditMode: value => h.actions.push(["mode", value]) }) },
    })("src/components/PageComponents/TaskDetail/TopRow/CreateSummaryButton.tsx");
    Button().props.children.props.onClick();
    assert.deepEqual(h.actions, enabled ? [["mode", "description-ai"]] : [["chat", 123]]);
  }
});

test("keyboard and writer toggle preserve description and comment routing", () => {
  for (const enabled of [false, true]) for (const mode of ["read-edit-description", "create-comment", "read-edit-comments"]) for (const commentInline of [false, true]) for (const apple of [false, true]) {
    const h = harness(enabled, commentInline);
    const inline = mode === "read-edit-description" ? enabled : commentInline;
    const context = { ...h.context(mode), isApple: apple, toggleAiTaskWriter: () => h.actions.push(["toggle"]) };
    const keyboard = loader(h.mocks)("src/components/RTE/useTaskDetailEditorKeyboard.tsx").useTaskDetailEditorKeyboard(() => context);
    let prevented = false;
    keyboard.handleKeydown({ key: "j", keyCode: 74, ctrlKey: !apple, metaKey: apple, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.deepEqual(h.actions, inline ? [["toggle"]] : [["commands", { show: true, mode: "command", paletteTab: "compose" }]]);
    h.actions.length = 0;
    const view = mount();
    try {
      loader(h.mocks)("src/components/RTE/useTaskDetailEditorSave.tsx").useTaskDetailEditorSave(() => context).toggleAiTaskWriter();
      assert.equal(h.writer(), inline);
      assert.deepEqual(h.actions, inline ? [] : [["blur"], ["chat", 123]]);
    } finally { view.close(); }
  }
});

test("targeted events seed description drafts without starting requests", () => {
  for (const enabled of [false, true]) for (const prompt of ["", "rewrite this"]) {
    const view = mount();
    const h = harness(enabled);
    const context = { ...h.context("read-edit-description"), shouldTriggerAiTaskWriter: false, suggestReplyAbortRef: {} };
    const { useTaskDetailEditorEvents } = loader({ ...h.mocks,
      "@/hooks/MultiPages/useClickOutside": { default: () => {} },
      "../PageComponents/TaskDetail/TopRow/CreateSummaryButton": { AI_TASK_WRITER_EVENT: "ai-trigger" },
      "./Components/EmojiGifPicker": { OPEN_EMOJI_GIF_PICKER_EVENT: "emoji" },
    })("src/components/RTE/useTaskDetailEditorEvents.tsx");
    function Hook() { useTaskDetailEditorEvents(context); return null; }
    try {
      view.render(React.createElement(Hook));
      window.dispatchEvent(new window.CustomEvent("ai-trigger", { detail: { targetId: "other", prompt } }));
      assert.deepEqual(h.actions, []);
      window.dispatchEvent(new window.CustomEvent("ai-trigger", { detail: { targetId: "description", prompt } }));
      assert.equal(h.writer(), enabled);
      assert.deepEqual(h.actions, enabled ? [["prompt", { autoTrigger: false, initialPrompt: prompt }]] : [["chat", 123]]);
    } finally { view.close(); }
  }
});

test("initial writer visibility ignores compose suppression only for descriptions with the fix", () => {
  for (const enabled of [false, true]) for (const mode of ["read-edit-description", "create-comment"]) {
    const h = harness(enabled);
    const mocks = { ...h.mocks,
      "@tanstack/react-query": { useQueryClient: () => ({}) },
      "@/lib/state": { useRecoilState: () => [{ id: 985 }, () => {}] },
      "@/hooks/General/useGetUserPreferences": { useGetUserPreferences: () => ({ data: {} }) },
      "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
      "./Tiptap": { default: () => ({ editor: {} }) },
      "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => ({ parsedTask: JSON.stringify({ id: 123 }) }) },
      "next/navigation": { useRouter: () => ({}), useSearchParams: () => new URLSearchParams() },
      "@/lib/contexts/TaskDetail/DescriptionProvider": { useDescriptionAndCommentsContext: () => ({}) },
      "@/lib/taskDetailArchiveNavigation": { shouldAdvanceAfterNotificationArchive: () => false },
      "@/hooks/General/useMobileVisualViewport": { useMobileVisualViewport: () => null },
    };
    const hook = loader(mocks)("src/components/RTE/useTaskDetailEditorState.tsx").useTaskDetailEditorState;
    assert.equal(runHook(hook, [{ mode, shouldTriggerAiTaskWriter: true }]).shouldShowAiTaskWriter, enabled && mode === "read-edit-description");
  }
});

test("flag defaults to Everyone", () => {
  const definition = loader()(`src/lib/flags/definitions/${flag}.ts`).default;
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
});

test("opening a restored description never auto-generates, while other openings remain unchanged", () => {
  for (const enabled of [false, true]) {
    const { taskDetailEditorPresentation } = loader({ "@/lib/taskDetailInboxFlow": {}, "@/utils/helperFunctions/isContentCarouselImage": {} })("src/components/RTE/taskDetailEditorPresentation.tsx");
    const presentation = taskDetailEditorPresentation({
      descriptionInlineDrafts: enabled, mode: "read-edit-description", currentTask: { title: "A task", description_: { content: "<p>Draft</p>" } },
      getDefaultMode: () => "AiTaskWriter", shouldShowInlineDraftAiRef: {}, aiTriggerData: { autoTrigger: false, initialPrompt: "" },
    });
    assert.equal(presentation.taskWriterOpening.autoTrigger, !enabled);
    if (enabled) assert.equal(presentation.taskWriterOpening.initialPrompt, "");
  }
});

test("applying a draft updates the editor; saving persists that content", async () => {
  const h = harness(true);
  let content = "<p>Original</p>";
  const calls = [];
  const context = { ...h.context("read-edit-description"),
    editor: { commands: { setContent: value => { content = value; }, unsetHighlight: () => {}, blur: () => {} }, getHTML: () => content, getText: () => "Revised", setEditable: () => {} },
    newCommentAttachments: [], setNewCommentAttachments: () => {}, setTrigger: () => {}, handleFocus: () => {},
    handleSave: async value => { calls.push(value); return true; }, saveInFlightRef: {}, mobileEditSavingRef: {}, mobileEditSnapshotRef: { current: null }, cancelDebounceRef: {},
    setSaveInFlight: () => {}, clearDescriptionDraftCache: () => calls.push("cleared"),
  };
  const { useTaskDetailEditorWriter } = loader({ ...h.mocks, "@/lib/ai/autoDescriptionSuggestion": {} })("src/components/RTE/useTaskDetailEditorWriter.tsx");
  useTaskDetailEditorWriter(() => context).handleAISave("<p>Revised</p>");
  assert.equal(content, "<p>Revised</p>");
  assert.equal(calls.length, 0);
  const { useTaskDetailEditorSave } = loader(h.mocks)("src/components/RTE/useTaskDetailEditorSave.tsx");
  assert.equal(await useTaskDetailEditorSave(() => context).handleCallback(), true);
  assert.equal(calls[0].content, "<p>Revised</p>");
  assert.equal(calls[0].mode, "read-edit-description");
  assert.equal(calls[1], "cleared");
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
    "@/lib/taskDetailCommentsStacked": { commentsStackedSetting: ({ preferenceStacked }) => preferenceStacked, foldCommentsFromFirstPaintNow: () => false },
  })("src/hooks/Task Detail/useTaskDetailGlobalStates.ts").default;
}


test("global description shortcuts enter inline editing only when enabled", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const task = { id: 123, userId: 985, projectId: 7049, description_: { content: "body" } };
  for (const enabled of [false, true]) for (const refocus of [false, true]) {
    const view = mount();
    const h = harness(enabled);
    let api;
    function Hook() { api = globalHook(h)(task, '{"comments":[]}', {}, {}); return null; }
    try {
      view.render(React.createElement(Hook));
      const target = document.createElement("div");
      target.id = "description-container"; target.tabIndex = 0; document.body.append(target);
      if (!refocus) target.focus();
      React.act(() => refocus ? api.refocusAndOpenTaskWriter(target.id) : api.CTRL_J_ENTER_Handler(true));
      assert.deepEqual(h.actions.filter(([kind]) => kind === "chat" || kind === "commands"), enabled ? [] : refocus ? [["chat", 123]] : [["commands", { show: true, mode: "command", paletteTab: "compose" }]]);
      if (enabled) {
        React.act(() => t.mock.timers.tick(100));
        assert.equal(api.editMode, "description-ai");
      }
    } finally { view.close(); }
  }
});

test("initial description trigger survives the compose window suppression", () => {
  for (const enabled of [false, true]) {
    const view = mount();
    const h = harness(enabled);
    const context = { ...h.context("read-edit-description"), shouldTriggerAiTaskWriter: true, suggestReplyAbortRef: {} };
    const { useTaskDetailEditorEvents } = loader({ ...h.mocks,
      "@/hooks/MultiPages/useClickOutside": { default: () => {} },
      "../PageComponents/TaskDetail/TopRow/CreateSummaryButton": { AI_TASK_WRITER_EVENT: "ai-trigger" },
      "./Components/EmojiGifPicker": { OPEN_EMOJI_GIF_PICKER_EVENT: "emoji" },
    })("src/components/RTE/useTaskDetailEditorEvents.tsx");
    function Hook() { useTaskDetailEditorEvents(context); return null; }
    try { view.render(React.createElement(Hook)); assert.equal(h.writer(), enabled); }
    finally { view.close(); }
  }
});
