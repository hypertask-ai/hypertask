const assert = require("node:assert/strict");
const test = require("node:test");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

const flag = "htpr-7480-comment-skill-run";
const inlineFlag = "htpr-7393-comment-inline-ai";
const keys = {
  HTPR_7480_COMMENT_SKILL_RUN_FLAG: flag,
  HTPR_7393_COMMENT_INLINE_AI_FLAG: inlineFlag,
};
const skill = { slug: "deeper", name: "Deeper", description: "Think deeply", isProject: true };

async function pick({ mode = "create-comment", enabled = true, inline = true, base = false, keyboard = false, targetId = "comment-input", query = "", skills = [skill] } = {}) {
  const view = mount();
  const events = [];
  let writer = false;
  let trigger;
  const range = { from: 8, to: 12 };
  let content = "Before /dee after";
  const target = document.createElement("div");
  target.id = targetId;
  if (mode === "read-edit-comments") target.className = "comment-edit-container";
  const dom = document.createElement("div");
  target.append(dom);
  document.body.append(target);
  const editor = {
    storage: { slashCommands: { mode } }, view: { dom },
    state: { doc: { textBetween: () => " " } },
    chain() {
      return {
        focus() { return this; },
        deleteRange(value) { assert.deepEqual(value, range); content = content.slice(0, 7) + content.slice(11); return this; },
        insertContent(value) { content = content.slice(0, 7) + value + content.slice(7); return this; },
        run() { return true; },
      };
    },
  };
  const onEvent = event => events.push(event.detail);
  window.addEventListener("ai-task-writer-trigger", onEvent);
  const load = loader({
    "@/hooks/useFlag": { useFlag: key => key === flag ? enabled : key === inlineFlag ? inline : false },
    "@/lib/flags/keys": keys,
    "@/lib/state": { useRecoilState: () => [{ id: 7049 }, () => {}], useSetRecoilState: () => () => {} },
    "@/store": { currentProjectAtom: "project" },
    "@/assets/AILogo.png": { default: { src: "ai.png" } },
    "@/lib/skills/slashSkills": {
      ...loader()("src/lib/skills/slashSkills.ts"),
      fetchSlashSkills: async () => skills,
    },
    "@/hooks/MultiPages/AIChat/useCommentToAiChat": { useCommentToAiChat: () => ({ editTicketWithAi: () => assert.fail("Skill pick must not open sidebar chat") }) },
    "@/models/enums": { CommandMode: { Command: "command" } },
    "@/hooks/MultiPages/useClickOutside": { default: () => {} },
    "./Components/EmojiGifPicker": { OPEN_EMOJI_GIF_PICKER_EVENT: "emoji" },
    "../PageComponents/TaskDetail/TopRow/CreateSummaryButton": { AI_TASK_WRITER_EVENT: "ai-task-writer-trigger" },
    "../../../PageComponents/TaskDetail/TopRow/CreateSummaryButton": {
      AI_TASK_WRITER_EVENT: "ai-task-writer-trigger",
    },
  });
  const CommandsList = load("src/components/RTE/Extensions/SlashCommands/CommandsList.tsx").default;
  const { useTaskDetailEditorEvents } = load("src/components/RTE/useTaskDetailEditorEvents.tsx");
  function Events() {
    useTaskDetailEditorEvents({
      mode, id: targetId, currentTask: { id: 123 }, divIds: {}, suggestReplyAbortRef: {},
      setShouldShowAITaskWriter: value => { writer = value; },
      setAiTriggerData: value => { trigger = value; },
    });
    return null;
  }
  const ref = React.createRef();
  const props = {
    ref, editor, range, query, items: base ? [{ title: "Bold", icon: () => null, command: () => { content = "bold"; } }] : [],
    command: item => item.command({ editor, range, mode, currentProjectId: item.currentProjectId }),
  };
  try {
    await React.act(async () => { view.render(React.createElement(React.Fragment, null, React.createElement(Events), React.createElement(CommandsList, props))); });
    const item = view.container.querySelector("li");
    if (item) React.act(() => keyboard
      ? ref.current.onKeyDown({ event: { key: "Enter" } })
      : item.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true })));
    if (events.length) {
      assert.equal(writer, true, "targeted comment writer opens");
      assert.deepEqual(trigger, { autoTrigger: true, initialPrompt: events[0].prompt });
    }
    return { content, events, visible: Boolean(item) };
  } finally { view.close(); }
}

test("comment skill picks remove only the slash query and open that editor's writer with the intact skill prompt", async () => {
  for (const mode of ["create-comment", "read-edit-comments"]) for (const keyboard of [false, true]) {
    const targetId = mode === "create-comment" ? "comment-input" : "comment-2";
    assert.deepEqual(await pick({ mode, keyboard, targetId }), {
      content: "Before  after", events: [{ targetId, prompt: "/deeper " }], visible: true,
    });
  }
});

test("flag-off, inline-writer-off and AI-chat skill picks keep inserting text", async () => {
  for (const options of [{ enabled: false }, { inline: false }, { mode: "ai-chat" }]) {
    assert.deepEqual(await pick(options), { content: "Before /deeper  after", events: [], visible: true });
  }
  for (const options of [{ mode: "read-edit-description" }, { mode: "read-edit-comments", enabled: false }]) {
    assert.deepEqual(await pick(options), { content: "Before /dee after", events: [], visible: false });
  }
});

test("non-skill commands and untargeted editors keep their original command behavior", async () => {
  assert.deepEqual(await pick({ base: true }), { content: "bold", events: [], visible: true });
  assert.deepEqual(await pick({ targetId: "unrelated" }), { content: "Before /deeper  after", events: [], visible: true });
});

test("builtin readability skill runs even when the server skill list is empty", async () => {
  assert.deepEqual(await pick({ query: "i", skills: [] }), {
    content: "Before  after", events: [{ targetId: "comment-input", prompt: "/i " }], visible: true,
  });
  const result = await loader()("src/app/api/ai/_lib/skills.ts").resolveSkills("/i ", { userId: 985, projectId: 7049 });
  assert.deepEqual(result.skills.map(item => item.slug), ["i"]);
  assert.match(result.systemPromptAddition, /built-in formatting template/);
});

test("skill prompts reach AITaskWriter rather than the draft editor that drops initialPrompt", () => {
  const { taskDetailEditorPresentation } = loader({
    "@/lib/taskDetailInboxFlow": {},
    "@/utils/helperFunctions/isContentCarouselImage": {},
  })("src/components/RTE/taskDetailEditorPresentation.tsx");
  for (const mode of ["create-comment", "read-edit-comments"]) for (const commentSkillRun of [false, true]) for (const mobileExistingEditOpen of [false, true]) {
    for (const initialPrompt of ["/deeper ", "rewrite this", ""]) {
      const result = taskDetailEditorPresentation({
        mode, commentSkillRun, mobileExistingEditOpen, shouldShowAiTaskWriter: true,
        getDefaultMode: () => "WriteWithAI", shouldShowInlineDraftAiRef: {},
        currentTask: { title: "QA", description_: { content: "Ticket body" } },
        aiTriggerData: { autoTrigger: true, initialPrompt },
      });
      const skillWriter = commentSkillRun && initialPrompt === "/deeper ";
      assert.equal(result.shouldShowFullAiTaskWriter, skillWriter);
      assert.equal(result.shouldShowInlineDraftAi, !skillWriter);
      if (skillWriter) assert.deepEqual(result.taskWriterOpening, { autoTrigger: true, initialPrompt: "/deeper " });
    }
  }
});

test("writer prompt retains the slash token until the server expands the chosen skill", async () => {
  const load = loader();
  const { buildTaskWriterPrompt } = load("src/lib/ai/autoDescriptionSuggestion.ts");
  const { resolveSkills } = load("src/app/api/ai/_lib/skills.ts");
  const view = mount();
  const previousParser = global.DOMParser;
  const previousFetch = global.fetch;
  global.DOMParser = window.DOMParser;
  let payload;
  global.fetch = async (url, options) => {
    assert.equal(url, "/api/ai/task-writer");
    payload = JSON.parse(options.body);
    return { ok: true, body: { getReader: () => ({ read: async () => ({ done: true }) }) } };
  };
  const useAITaskWriter = loader({
    "@/hooks/General/useCurrentBoardBilling": { useCurrentBoardBilling: () => null },
    "@/lib/byokSelectedProviderGate": { shouldBlockAiDueToByokProvider: () => false },
    "@/utils/helperFunctions/helperFunctions": {},
    "@/utils/helperFunctions/getFileTypeFromUrl": {},
    "@/lib/deriveCurrentBoardBilling": {},
  })("src/hooks/MultiPages/AiWriter/useAiTaskWriter.ts").default;
  let writer;
  function Writer() {
    writer = useAITaskWriter({ id: 7049, teamId: "qa" }, { id: "qa", source: "qa" }, "WriteWithAI", undefined, [], "Comment draft", { id: 123, description_: { content: "Ticket body" } }, null);
    return null;
  }
  try {
    view.render(React.createElement(Writer));
    await React.act(async () => { await writer.sendAIRequest(buildTaskWriterPrompt("/deeper ", "QA ticket")); });
    assert.equal(payload.projectId, 7049);
    assert.deepEqual(payload.taskIds, [123]);
    assert.match(payload.PROMPT, /Original Description: Ticket body/);
    assert.match(payload.PROMPT, /\n\/deeper $/);
  } finally {
    global.fetch = previousFetch;
    global.DOMParser = previousParser;
    view.close();
  }
  const result = await resolveSkills(payload.PROMPT, { userId: 985, projectId: payload.projectId }, async (slugs, context) => {
    assert.deepEqual(slugs, ["deeper"]);
    assert.deepEqual(context, { userId: 985, projectId: 7049 });
    return [{ id: 1, slug: "deeper", name: "Deeper", body: "Explore carefully", projectId: 7049, userId: null }];
  });
  assert.deepEqual(result.skills.map(item => item.slug), ["deeper"]);
  assert.match(result.systemPromptAddition, /Explore carefully/);
  assert.doesNotMatch(result.cleanedText, /\/deeper/);
});

test("bugfix flag releases to Everyone with a bounded rollback risk", () => {
  const definition = loader()(`src/lib/flags/definitions/${flag}.ts`).default;
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.shippedOn, "2026-10-20");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason);
});
