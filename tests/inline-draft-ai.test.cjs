const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const { createPromptForTiptapForwardSlash } = jiti(
  path.join(root, "src/app/api/ai/_lib/editorAi.ts"),
);
const { tiptapForwardSlashRequestSchema } = jiti(
  path.join(root, "src/app/api/ai/tiptap-forwardslash/requestSchema.ts"),
);
const {
  createInlineDraftAiSourceSnapshot,
  initialInlineDraftAiReviewState,
  inlineDraftAiCommandForInstruction,
  inlineDraftAiReviewReducer,
  isInlineDraftAiSourceFresh,
  nextInlineDraftAiScope,
  resolveInitialInlineDraftAiRange,
  rewrittenInlineDraftAiRange,
  shouldShowInlineDraftAiChips,
  inlineDraftAiWritePlaceholder,
  mergeInlineDraftAiDictation,
} = jiti(path.join(root, "src/components/RTE/Components/inlineDraftAi.ts"));

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

  const review = inlineDraftAiReviewReducer(loading, {
    type: "resolve",
    requestId: 1,
    proposal: "<p>Clear draft</p>",
  });
  assert.equal(review.phase, "review");
  assert.equal(review.proposal, "<p>Clear draft</p>");
  assert.equal(descriptor.sourceContent, "<p>rough draft</p>");
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

  assert.equal(isInlineDraftAiSourceFresh(original, snapshot), true);
  assert.equal(
    isInlineDraftAiSourceFresh(
      schema.node("doc", null, [paragraph("Changed draft")]),
      snapshot,
    ),
    false,
  );
  assert.equal(
    isInlineDraftAiSourceFresh(
      schema.node("doc", null, [paragraph("Original draft"), paragraph("new")]),
      snapshot,
    ),
    false,
  );
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
