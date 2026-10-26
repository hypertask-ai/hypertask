const assert = require("node:assert/strict");
const test = require("node:test");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");
const tiptap = require("@tiptap/react");
const { Extension } = require("@tiptap/core");

const flag = "htpr-7879-skill-menu";
const sidebarFlag = "htpr-7800-skill-runs-in-sidebar";
const keys = {
  HTPR_7480_COMMENT_SKILL_RUN_FLAG: "comment-skills",
  HTPR_7393_COMMENT_INLINE_AI_FLAG: "inline-ai",
  HTPR_7337_EDIT_WITH_AI_FLAG: "edit-ai",
};
const boardSkills = [
  { slug: "deeper", name: "Deeper", enabled: true, projectId: 15 },
  { slug: "minimalist-review", name: "Minimalist review", enabled: true, projectId: 15 },
];

async function withEditor({ chat = false, enabled = true, sidebar = true, inline = true, execution = true, boardPageId = 7049 } = {}, run) {
  const view = mount();
  const globals = {
    fetch: async url => {
      requests.push(url);
      const projectId = new URL(url, "https://app.hypertask.ai").searchParams.get("projectId");
      return { ok: true, json: async () => ({ skills: projectId === "15" ? boardSkills : [
        { slug: "qa-7480-check", name: "QA personal skill", enabled: true, projectId: null },
      ] }) };
    },
    getComputedStyle: window.getComputedStyle,
    DOMRect: window.DOMRect,
    Element: window.Element,
    Node: window.Node,
    requestAnimationFrame: callback => setTimeout(callback, 0),
    cancelAnimationFrame: clearTimeout,
  };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(global, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(global, key, { configurable: true, writable: true, value });
  const requests = [];
  const sends = [];
  let projectId = 15;
  let editor;
  const unused = Extension.create({ name: "unused" });
  const mocks = {
    "@tiptap/react": { ...tiptap, useEditor: options => tiptap.useEditor({
      ...options,
      extensions: options.extensions.filter(extension => ["starterKit", "slashCommands"].includes(extension.name)),
    }) },
    "@/hooks/useFlag": { useFlag: key => key === flag ? enabled ?? undefined : key === sidebarFlag ? sidebar : key === "inline-ai" ? inline : key === "comment-skills" ? execution : false },
    "@/lib/flags/keys": keys,
    "@/models/enums": { CommandMode: { Command: "command" } },
    "@/lib/state": { useRecoilState: () => [boardPageId == null ? undefined : { id: boardPageId }, () => {}], useSetRecoilState: () => () => {} },
    "@/store": { currentProjectAtom: "project", showCommandsAtom: "commands" },
    "@/assets/AILogo.png": { default: { src: "ai.png" } },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "@/utils/helperFunctions/helperFunctions": { getRandomElement: () => "Comment" },
    "@/lib/constants": { default: { CommentTips: () => [], DescriptionTips: () => [] } },
    "@/lib/snippets": {},
    "@/lib/storage/uploadViaApi": {},
    "./suggestion": { default: {} },
    "./MentionData": { createMentionData: () => ({}) },
    "@/components/RTE/Components/AI_Chat/MentionData": { createMentionData: () => ({}) },
    "./Extensions/DeleteMentionOnBackspace": { withMentionBackspaceDeletion: () => [] },
    "./Extensions/LinkableMention": { LinkableMention: unused },
    "@/components/RTE/Extensions/LinkableMention": { LinkableMention: unused },
    "./Extensions/resizableMedia": { ResizableMedia: unused },
    "./Extensions/LoomTiptap": { Loom: unused },
    "./Extensions/FigmaTiptap": { Figma: unused },
    "./Extensions/YoutubeTiptap": { Youtube: unused },
    "./Extensions/HtmlBlock": { HtmlBlock: unused },
    "./Extensions/ReplyBlockquote": { ReplyBlockquote: unused },
    "./Extensions/Hypertask-Links": { HypertaskPasteRule: unused },
    "./Extensions/LazyEmoji": { default: unused },
    "./Extensions/Snippets/Snippets": { default: unused },
    "./writingAssistance": { LocalWritingAssistance: unused, writingAssistanceEditorProps: {} },
    "@/components/RTE/writingAssistance": { LocalWritingAssistance: unused, writingAssistanceEditorProps: {} },
    "../../Components/EmojiGifPicker": { OPEN_EMOJI_GIF_PICKER_EVENT: "emoji" },
    "./Components/EmojiGifPicker": { OPEN_EMOJI_GIF_PICKER_EVENT: "emoji" },
    "@/components/PageComponents/TaskDetail/TopRow/CreateSummaryButton": { AI_TASK_WRITER_EVENT: "ai-trigger" },
    "../PageComponents/TaskDetail/TopRow/CreateSummaryButton": { AI_TASK_WRITER_EVENT: "ai-trigger" },
    "@/hooks/MultiPages/AIChat/useCommentToAiChat": { useCommentToAiChat: () => ({ editTicketWithAi() {}, runCommentSkill: async (...args) => { sends.push(args); return true; } }) },
    "@/hooks/MultiPages/useClickOutside": { default: () => {} },
  };
  const load = loader(mocks);
  const useEditor = load(chat ? "src/hooks/MultiPages/AIChat/useAiTiptap.ts" : "src/components/RTE/Tiptap.ts").default;
  const { useTaskDetailEditorEvents } = load("src/components/RTE/useTaskDetailEditorEvents.tsx");
  function Composer() {
    ({ editor } = useEditor(chat ? { projectId, contextCallback() {} } : {
      mode: "create-comment", editorId: "comment-input", mentionProjectId: projectId, trackFocus: false,
    }));
    useTaskDetailEditorEvents({
      mode: chat ? "ai-chat" : "create-comment", id: "comment-input", editor,
      currentTask: { id: 123, projectId }, divIds: {}, suggestReplyAbortRef: {},
      setShouldShowAITaskWriter() {}, setAiTriggerData() {},
    });
    return React.createElement(tiptap.EditorContent, { editor });
  }
  try {
    await React.act(async () => view.render(React.createElement(Composer)));
    assert.ok(editor, "production editor hook creates the editor");
    await run({
      requests, sends, editor,
      menu: () => document.getElementById("ht-slash-command-menu"),
      async type(value) {
        await React.act(async () => {
          editor.commands.setContent("<p></p>");
          editor.commands.insertContent(value);
          await new Promise(resolve => setImmediate(resolve));
        });
      },
      async setProject(id) {
        projectId = id;
        await React.act(async () => view.render(React.createElement(Composer)));
      },
    });
  } finally {
    await React.act(async () => editor?.destroy());
    view.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  }
}

test("comment slash suggestions open with the ticket board's skills regardless of sidebar execution flags", async () => {
  for (const sidebar of [false, true]) for (const inline of [false, true]) for (const execution of [false, true]) {
    await withEditor({ sidebar, inline, execution }, async ({ type, menu, requests }) => {
      await type("/");
      assert.ok(menu(), "typing slash opens the existing suggestion popup");
      assert.match(menu().textContent, /\/minimalist-review/, "board skill is listed even with stale board-page state");
      assert.deepEqual(requests, ["/api/ai/skills?projectId=15"]);
      await type("/minimalist");
      assert.match(menu().textContent, /\/minimalist-review/);
    });
  }
});

test("chat slash suggestions request the selected project, track board switches, and preserve personal scope", async () => {
  await withEditor({ chat: true, boardPageId: null }, async ({ type, menu, requests, setProject }) => {
    await type("/");
    assert.deepEqual(requests, ["/api/ai/skills?projectId=15"], "chat must not request the personal skill list for a selected board");
    assert.match(menu().textContent, /\/minimalist-review/);
    await setProject(7049);
    await type("/");
    assert.equal(requests.at(-1), "/api/ai/skills?projectId=7049");
    assert.match(menu().textContent, /\/qa-7480-check/);
    await setProject(undefined);
    await type("/");
    assert.equal(requests.at(-1), "/api/ai/skills");
    assert.match(menu().textContent, /\/qa-7480-check/);
  });
});

test("Enter selects a board skill instead of inserting a newline and retains sidebar routing", async () => {
  await withEditor({}, async ({ type, editor, sends }) => {
    await type("/minimalist");
    const event = new window.KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true, cancelable: true });
    await React.act(async () => editor.view.dom.dispatchEvent(event));
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(sends, [[123, "/minimalist-review ", ""]]);
    assert.equal(editor.getHTML(), "<p></p>");
  });
});

test("rollback does not hide slash menus or depend on sidebar execution being enabled", async () => {
  for (const enabled of [false, null]) for (const sidebar of [false, true]) {
    await withEditor({ enabled, sidebar, boardPageId: 15 }, async ({ type, menu }) => {
      await type("/");
      assert.match(menu().textContent, /\/minimalist-review/);
    });
  }
});
