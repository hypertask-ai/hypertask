const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  jsx: true,
  alias: { "@": path.join(root, "src") },
});

const { createPromptForTiptapForwardSlash } = jiti(
  path.join(root, "src/app/api/ai/_lib/editorAi.ts"),
);
const { tiptapForwardSlashRequestSchema } = jiti(
  path.join(root, "src/app/api/ai/tiptap-forwardslash/requestSchema.ts"),
);
const {
  applyInlineDraftAiProposalIfFresh,
  createInlineDraftAiSourceSnapshot,
  initialInlineDraftAiReviewState,
  inlineDraftAiCommandForInstruction,
  inlineDraftAiReviewReducer,
  nextInlineDraftAiScope,
  resolveInitialInlineDraftAiRange,
  rewrittenInlineDraftAiRange,
  shouldShowInlineDraftAiChips,
  inlineDraftAiWritePlaceholder,
  mergeInlineDraftAiDictation,
} = jiti(path.join(root, "src/components/RTE/Components/inlineDraftAi.ts"));

const originalCache = new Map(Object.entries(require.cache));
const stubModule = (filename, exports) => {
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
};
const stubSourceModule = (relativePath, exports) =>
  stubModule(path.join(root, relativePath), exports);

stubModule(require.resolve("@tiptap/react"), {
  EditorContent: () => React.createElement("div"),
  useEditorState: ({ editor, selector }) => selector({ editor }),
});
stubModule(require.resolve("react-hot-toast"), {
  default: {
    dismiss: () => {},
    promise: async (promise) => promise,
  },
});
stubSourceModule("src/components/Common/SendArrow.tsx", {
  SendArrow: () => React.createElement("span"),
});
stubSourceModule("src/components/RTE/Components/AudioButton.tsx", {
  AudioButton: () => React.createElement("button"),
});
stubSourceModule("src/components/Modals/Sheets/AppSheet.tsx", {
  AppSheet: ({ children }) => React.createElement("div", null, children),
});
stubSourceModule(
  "src/components/Modals/Sheets/mobileOverlayAppSheetStyles.ts",
  {
    MOBILE_OVERLAY_SHEET_Z: 280,
    mobileOverlayAppSheetBodyClass: "",
    mobileOverlayAppSheetEditorWellClass: "",
    mobileOverlayAppSheetHandleBarClass: "",
    mobileOverlayAppSheetHandleHeaderClass: "",
    mobileOverlayAppSheetHandleRowClass: "",
    mobileOverlayAppSheetPanelClass: "",
  },
);
stubSourceModule("src/hooks/General/useMobileVisualViewport.ts", {
  useMobileVisualViewport: () => null,
});
stubSourceModule("src/styles/tiptap.module.scss", {
  editorContainer: "editor-container",
});
stubSourceModule("src/utils/undoActions/helperFuncs.ts", {
  cn: (...values) => values.filter(Boolean).join(" "),
});

const previousGlobalReact = global.React;
global.React = React;
const InlineDraftAiFloat = jiti(
  path.join(root, "src/components/RTE/Components/InlineDraftAiFloat.tsx"),
).default;
test.after(() => {
  if (previousGlobalReact === undefined) delete global.React;
  else global.React = previousGlobalReact;
});

for (const filename of Object.keys(require.cache)) {
  if (!originalCache.has(filename)) delete require.cache[filename];
}
for (const [filename, cachedModule] of originalCache) {
  require.cache[filename] = cachedModule;
}

test("inline draft AI prompt clicks do not bubble back to the comment editor", async (t) => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>");
  const previousGlobals = {
    window: global.window,
    document: global.document,
    HTMLElement: global.HTMLElement,
    Node: global.Node,
    Event: global.Event,
    MouseEvent: global.MouseEvent,
    CustomEvent: global.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT,
  };
  dom.window.HTMLElement.prototype.attachEvent = () => {};
  dom.window.HTMLElement.prototype.detachEvent = () => {};
  Object.assign(global, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    CustomEvent: dom.window.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  });

  const editorDom = document.createElement("div");
  const editor = {
    state: {
      selection: { from: 1, to: 1 },
      doc: { content: { size: 2 } },
    },
    isEmpty: true,
    isEditable: true,
    view: { dom: editorDom },
    commands: {
      setTextSelection: () => {},
      unsetHighlight: () => {},
      focus: () => {},
    },
    on: () => {},
    off: () => {},
    setEditable: () => {},
  };
  let parentClicks = 0;
  const container = document.getElementById("root");
  const reactRoot = createRoot(container);

  t.after(async () => {
    await act(async () => reactRoot.unmount());
    Object.assign(global, previousGlobals);
    dom.window.close();
  });

  await act(async () => {
    reactRoot.render(
      React.createElement(
        "div",
        { onClick: () => parentClicks += 1 },
        React.createElement(InlineDraftAiFloat, {
          editor,
          onClose: () => {},
        }),
      ),
    );
  });

  const prompt = container.querySelector('input[placeholder="Describe what to write…"]');
  assert.ok(prompt);
  prompt.focus();
  prompt.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  assert.equal(parentClicks, 0);
  assert.equal(document.activeElement, prompt);
});

test("inline draft AI preserves a range and expands a collapsed caret over existing content", () => {
  assert.deepEqual(
    resolveInitialInlineDraftAiRange({
      from: 3,
      to: 8,
      docSize: 20,
      isEmpty: false,
    }),
    { from: 3, to: 8 },
  );
  assert.deepEqual(
    resolveInitialInlineDraftAiRange({
      from: 5,
      to: 5,
      docSize: 20,
      isEmpty: false,
    }),
    { from: 0, to: 20 },
  );
  assert.deepEqual(
    resolveInitialInlineDraftAiRange({
      from: 1,
      to: 1,
      docSize: 2,
      isEmpty: true,
    }),
    { from: 1, to: 1 },
  );
});

test("inline draft AI chips require selected content and an empty prompt", () => {
  assert.equal(shouldShowInlineDraftAiChips(true, ""), true);
  assert.equal(shouldShowInlineDraftAiChips(true, "  simplify this"), false);
  assert.equal(shouldShowInlineDraftAiChips(false, ""), false);
  assert.equal(inlineDraftAiCommandForInstruction(true), "CustomEdit");
  assert.equal(inlineDraftAiCommandForInstruction(false), "WriteContent");
});

test("inline draft AI write placeholder mentions Shift+R on empty comment drafts", () => {
  assert.match(
    inlineDraftAiWritePlaceholder(false, true, true),
    /Shift\+R/i,
  );
  assert.equal(
    inlineDraftAiWritePlaceholder(false, false, true),
    "Describe what to write…",
  );
  assert.equal(
    inlineDraftAiWritePlaceholder(true, true, true),
    "Describe how to edit the text…",
  );
});

test("inline draft AI caps appended and replacement dictation at 2,000 characters", () => {
  assert.equal(mergeInlineDraftAiDictation("Draft ", "reply", false), "Draft reply");

  const appended = mergeInlineDraftAiDictation("a".repeat(1_999), "xyz", false);
  assert.equal(appended.length, 2_000);
  assert.equal(appended.endsWith("x"), true);

  const replacement = mergeInlineDraftAiDictation("ignored", "z".repeat(2_001), true);
  assert.equal(replacement, "z".repeat(2_000));
});

test("inline draft AI selects the replacement after a partial rewrite", () => {
  assert.deepEqual(
    rewrittenInlineDraftAiRange({
      oldDocSize: 20,
      newDocSize: 25,
      range: { from: 3, to: 8 },
    }),
    { from: 3, to: 13 },
  );
});

test("inline draft AI keeps scope when the editor selection collapses", () => {
  assert.deepEqual(
    nextInlineDraftAiScope({ from: 2, to: 9 }, { from: 4, to: 4 }),
    { from: 2, to: 9 },
  );
  assert.deepEqual(
    nextInlineDraftAiScope({ from: 2, to: 9 }, { from: 1, to: 4 }),
    { from: 1, to: 4 },
  );
});

test("mobile Write with AI keeps a generated proposal isolated until review", () => {
  const descriptor = {
    command: "ImproveReadability",
    label: "Improve readability",
    sourceContent: "<p>rough draft</p>",
  };
  const loading = inlineDraftAiReviewReducer(initialInlineDraftAiReviewState, {
    type: "request",
    requestId: 1,
    descriptor,
  });
  assert.equal(loading.phase, "loading");
  assert.equal(loading.proposal, "");
  assert.deepEqual(loading.lastRequest, descriptor);
  descriptor.sourceContent = "<p>mutated elsewhere</p>";
  assert.equal(loading.lastRequest.sourceContent, "<p>rough draft</p>");

  const review = inlineDraftAiReviewReducer(loading, {
    type: "resolve",
    requestId: 1,
    proposal: "<p>Clear draft</p>",
  });
  assert.equal(review.phase, "review");
  assert.equal(review.proposal, "<p>Clear draft</p>");
  assert.equal(review.lastRequest.sourceContent, "<p>rough draft</p>");
});

test("mobile Write with AI ignores late responses and replays immutable request descriptors", () => {
  const first = {
    command: "WriteContent",
    instruction: "Draft a reply",
    label: "Write comment",
    sourceContent: "",
  };
  const second = {
    command: "WriteContent",
    instruction: "Draft a shorter reply",
    label: "Write comment",
    sourceContent: "",
  };
  const requestOne = inlineDraftAiReviewReducer(initialInlineDraftAiReviewState, {
    type: "request",
    requestId: 4,
    descriptor: first,
  });
  const requestTwo = inlineDraftAiReviewReducer(requestOne, {
    type: "request",
    requestId: 5,
    descriptor: second,
  });
  const late = inlineDraftAiReviewReducer(requestTwo, {
    type: "resolve",
    requestId: 4,
    proposal: "<p>stale</p>",
  });
  assert.strictEqual(late, requestTwo);
  assert.deepEqual(late.lastRequest, second);

  const current = inlineDraftAiReviewReducer(late, {
    type: "resolve",
    requestId: 5,
    proposal: "<p>current</p>",
  });
  assert.equal(current.proposal, "<p>current</p>");
  assert.deepEqual(current.lastRequest, second);
});

test("mobile Write with AI refine and original preview preserve the proposal", () => {
  const descriptor = {
    command: "Simplify",
    label: "Simplify",
    sourceContent: "<p>Original</p>",
  };
  const review = inlineDraftAiReviewReducer(
    inlineDraftAiReviewReducer(initialInlineDraftAiReviewState, {
      type: "request",
      requestId: 7,
      descriptor,
    }),
    { type: "resolve", requestId: 7, proposal: "<p>Proposal</p>" },
  );
  const showingOriginal = inlineDraftAiReviewReducer(review, {
    type: "toggle-original",
  });
  assert.equal(showingOriginal.showOriginal, true);
  assert.equal(showingOriginal.proposal, "<p>Proposal</p>");

  const refining = inlineDraftAiReviewReducer(showingOriginal, {
    type: "refine",
  });
  assert.equal(refining.phase, "input");
  assert.equal(refining.isRefining, true);
  assert.equal(refining.proposal, "<p>Proposal</p>");
  assert.deepEqual(refining.lastRequest, descriptor);

  const failedRefine = inlineDraftAiReviewReducer(
    inlineDraftAiReviewReducer(refining, {
      type: "request",
      requestId: 8,
      descriptor: {
        command: "CustomEdit",
        instruction: "Make it warmer",
        label: "Refine",
        sourceContent: refining.proposal,
      },
    }),
    { type: "reject", requestId: 8 },
  );
  assert.equal(failedRefine.phase, "review");
  assert.equal(failedRefine.proposal, "<p>Proposal</p>");

  assert.deepEqual(
    inlineDraftAiReviewReducer(failedRefine, { type: "reset" }),
    initialInlineDraftAiReviewState,
  );
});

test("mobile Write with AI binds acceptance to the opening ProseMirror document", () => {
  const { Schema } = require("@tiptap/pm/model");
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { content: "text*", group: "block" },
      text: { group: "inline" },
    },
  });
  const paragraph = (text) =>
    schema.node("paragraph", null, text ? [schema.text(text)] : []);
  const original = schema.node("doc", null, [paragraph("Original draft")]);
  const snapshot = createInlineDraftAiSourceSnapshot(original, {
    from: 0,
    to: original.content.size,
  });

  const changed = schema.node("doc", null, [paragraph("Changed draft")]);
  const changedJson = changed.toJSON();
  let applied = null;
  assert.equal(
    applyInlineDraftAiProposalIfFresh({
      document: changed,
      snapshot,
      proposal: "<p>AI proposal</p>",
      apply: (proposal, range) => {
        applied = { proposal, range };
      },
    }),
    false,
  );
  assert.equal(applied, null);
  assert.deepEqual(changed.toJSON(), changedJson);

  assert.equal(
    applyInlineDraftAiProposalIfFresh({
      document: original,
      snapshot,
      proposal: "<p>AI proposal</p>",
      apply: (proposal, range) => {
        applied = { proposal, range };
      },
    }),
    true,
  );
  assert.deepEqual(applied, {
    proposal: "<p>AI proposal</p>",
    range: snapshot.range,
  });
});

test("inline draft AI request validation allows writing empty content only with an instruction", () => {
  assert.equal(
    tiptapForwardSlashRequestSchema.safeParse({
      content: "",
      command: "WriteContent",
      instruction: "Draft a concise reply",
    }).success,
    true,
  );
  assert.equal(
    tiptapForwardSlashRequestSchema.safeParse({
      content: "<p>Draft</p>",
      command: "CustomEdit",
    }).success,
    false,
  );
  assert.equal(
    tiptapForwardSlashRequestSchema.safeParse({
      content: "",
      command: "Simplify",
    }).success,
    false,
  );
});

test("inline draft AI prompt modes keep their distinct editing contracts", () => {
  assert.match(
    createPromptForTiptapForwardSlash("Simplify", "<p>Draft</p>"),
    /simpler words and shorter sentences/i,
  );
  assert.match(
    createPromptForTiptapForwardSlash("Unslop", "<p>Draft</p>"),
    /puffery, chatbot phrases, and AI tells/i,
  );
  assert.match(
    createPromptForTiptapForwardSlash("Structured", "<p>Draft</p>"),
    /numbered steps/i,
  );

  const custom = createPromptForTiptapForwardSlash(
    "CustomEdit",
    "<p>Draft</p>",
    "Make this warmer",
  );
  assert.match(custom, /Make this warmer/);
  assert.match(custom, /selected content only/i);

  const write = createPromptForTiptapForwardSlash(
    "WriteContent",
    "",
    "Draft a concise reply",
  );
  assert.match(write, /Draft a concise reply/);
  assert.match(write, /Write new content/i);
});
