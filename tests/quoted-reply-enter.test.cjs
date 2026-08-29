const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { Schema } = require("@tiptap/pm/model");
const { EditorState, TextSelection } = require("@tiptap/pm/state");

const workerThreads = require("node:worker_threads");
if (typeof workerThreads.markAsUncloneable !== "function") {
  workerThreads.markAsUncloneable = () => {};
}
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const replyQuoteConstants = {
  REPLY_QUOTE_DATA_ATTRIBUTE: "data-quote-reply",
  REPLY_QUOTE_NODE_ATTRIBUTE: "replyQuote",
};

function loadTypescriptModule(filePath, aliases = {}) {
  const source = fs.readFileSync(filePath, "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const module_ = { exports: {} };
  const localRequire = (specifier) => aliases[specifier] ?? require(specifier);
  new Function("require", "module", "exports", javascript)(
    localRequire,
    module_,
    module_.exports,
  );
  return module_.exports;
}

const { exitReplyBlockquoteOnEnter, moveAcrossBlockquoteOnArrow } =
  loadTypescriptModule(
    path.join(root, "src/components/RTE/Extensions/ReplyBlockquote.ts"),
    { "@/lib/richText/replyQuote": replyQuoteConstants },
  );

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    blockquote: {
      attrs: { replyQuote: { default: false } },
      content: "block+",
      group: "block",
    },
    container: { content: "block+", group: "block" },
    text: { group: "inline" },
  },
});

function createQuoteState({
  tagged = true,
  trailing = "none",
  cursorOffset = 0,
} = {}) {
  const paragraph = schema.nodes.paragraph.create(
    null,
    schema.text("quoted text"),
  );
  const quote = schema.nodes.blockquote.create(
    { replyQuote: tagged },
    paragraph,
  );
  const nodes = [quote];
  if (trailing === "empty") nodes.push(schema.nodes.paragraph.create());
  if (trailing === "notes") {
    nodes.push(
      schema.nodes.paragraph.create(null, schema.text("existing notes")),
    );
  }
  const doc = schema.nodes.doc.create(null, nodes);
  let textStart = -1;
  doc.descendants((node, position) => {
    if (textStart < 0 && node.isText) textStart = position;
  });
  const selection = TextSelection.create(doc, textStart + cursorOffset);
  return EditorState.create({ doc, selection });
}

function pressEnter(state) {
  let nextState = state;
  const handled = exitReplyBlockquoteOnEnter({
    state,
    dispatch: (transaction) => {
      nextState = state.apply(transaction);
    },
  });
  return { handled, nextState };
}

function pressArrow(state, direction, atVisualBoundary = true) {
  let nextState = state;
  const handled = moveAcrossBlockquoteOnArrow({
    state,
    direction,
    endOfTextblock: () => atVisualBoundary,
    dispatch: (transaction) => {
      nextState = state.apply(transaction);
    },
  });
  return { handled, nextState };
}

for (const cursorOffset of [0, 5, "quoted text".length]) {
  test(`Enter exits a tagged quoted reply without changing it at offset ${cursorOffset}`, () => {
    const state = createQuoteState({ cursorOffset });
    const quoteBefore = state.doc.child(0).toJSON();
    const { handled, nextState } = pressEnter(state);

    assert.equal(handled, true);
    assert.deepEqual(nextState.doc.child(0).toJSON(), quoteBefore);
    assert.equal(nextState.doc.childCount, 2);
    assert.equal(nextState.doc.child(1).type.name, "paragraph");
    assert.equal(nextState.doc.child(1).content.size, 0);
    assert.equal(nextState.selection.$from.parent.type.name, "paragraph");
    assert.equal(nextState.selection.$from.depth, 1);
  });
}

test("Enter focuses an existing empty paragraph after the quoted reply", () => {
  const state = createQuoteState({ trailing: "empty", cursorOffset: 3 });
  const { handled, nextState } = pressEnter(state);

  assert.equal(handled, true);
  assert.equal(nextState.doc.childCount, 2);
  assert.equal(nextState.selection.$from.parent, nextState.doc.child(1));
});

test("Enter inserts a note paragraph before existing text after the quote", () => {
  const state = createQuoteState({ trailing: "notes", cursorOffset: 3 });
  const { handled, nextState } = pressEnter(state);

  assert.equal(handled, true);
  assert.equal(nextState.doc.childCount, 3);
  assert.equal(nextState.doc.child(1).content.size, 0);
  assert.equal(nextState.doc.child(2).textContent, "existing notes");
  assert.equal(nextState.selection.$from.parent, nextState.doc.child(1));
});

test("manual blockquotes keep ProseMirror's ordinary Enter behavior", () => {
  const state = createQuoteState({ tagged: false, cursorOffset: 3 });
  const before = state.doc.toJSON();
  let dispatched = false;
  const handled = exitReplyBlockquoteOnEnter({
    state,
    dispatch: () => {
      dispatched = true;
    },
  });

  assert.equal(handled, false);
  assert.equal(dispatched, false);
  assert.deepEqual(state.doc.toJSON(), before);
});

test("ArrowDown leaves the final visual line of a blockquote", () => {
  const state = createQuoteState({
    tagged: false,
    trailing: "notes",
    cursorOffset: "quoted text".length,
  });
  const quoteBefore = state.doc.child(0).toJSON();
  const { handled, nextState } = pressArrow(state, "down");

  assert.equal(handled, true);
  assert.deepEqual(nextState.doc.child(0).toJSON(), quoteBefore);
  assert.equal(nextState.selection.$from.parent, nextState.doc.child(1));
  assert.equal(nextState.selection.$from.parentOffset, 0);
});

test("ArrowDown creates an outside line when the blockquote ends the document", () => {
  const state = createQuoteState({ cursorOffset: "quoted text".length });
  const quoteBefore = state.doc.child(0).toJSON();
  const { handled, nextState } = pressArrow(state, "down");

  assert.equal(handled, true);
  assert.deepEqual(nextState.doc.child(0).toJSON(), quoteBefore);
  assert.equal(nextState.doc.childCount, 2);
  assert.equal(nextState.doc.child(1).type.name, "paragraph");
  assert.equal(nextState.doc.child(1).content.size, 0);
  assert.equal(nextState.selection.$from.parent, nextState.doc.child(1));
});

test("ArrowDown enters an adjacent blockquote without changing the document", () => {
  const firstQuote = schema.nodes.blockquote.create(
    { replyQuote: false },
    schema.nodes.paragraph.create(null, schema.text("first quote")),
  );
  const secondQuote = schema.nodes.blockquote.create(
    { replyQuote: false },
    schema.nodes.paragraph.create(null, schema.text("second quote")),
  );
  const doc = schema.nodes.doc.create(null, [firstQuote, secondQuote]);
  const state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, 2 + "first quote".length),
  });
  const before = state.doc.toJSON();
  const { handled, nextState } = pressArrow(state, "down");

  assert.equal(handled, true);
  assert.deepEqual(nextState.doc.toJSON(), before);
  assert.equal(nextState.selection.$from.node(1), nextState.doc.child(1));
});

test("ArrowDown keeps native movement before the final visual line", () => {
  const state = createQuoteState({
    trailing: "empty",
    cursorOffset: "quoted text".length,
  });
  const before = state.doc.toJSON();
  const { handled, nextState } = pressArrow(state, "down", false);

  assert.equal(handled, false);
  assert.deepEqual(nextState.doc.toJSON(), before);
  assert.equal(nextState.selection.eq(state.selection), true);
});

test("ArrowDown stays inside a blockquote before its final paragraph", () => {
  const firstParagraph = schema.nodes.paragraph.create(
    null,
    schema.text("first line"),
  );
  const secondParagraph = schema.nodes.paragraph.create(
    null,
    schema.text("last line"),
  );
  const quote = schema.nodes.blockquote.create(
    { replyQuote: false },
    [firstParagraph, secondParagraph],
  );
  const doc = schema.nodes.doc.create(null, [
    quote,
    schema.nodes.paragraph.create(),
  ]);
  const state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, 2 + "first line".length),
  });
  const before = state.doc.toJSON();
  const { handled, nextState } = pressArrow(state, "down");

  assert.equal(handled, false);
  assert.deepEqual(nextState.doc.toJSON(), before);
  assert.equal(nextState.selection.eq(state.selection), true);
});

for (const trailing of ["empty", "notes"]) {
  const lineLabel = trailing === "empty" ? "an empty" : "a populated";
  test(`ArrowUp enters the preceding blockquote from ${lineLabel} outside line`, () => {
    const initial = createQuoteState({ tagged: false, trailing });
    const quote = initial.doc.child(0);
    const outsideTextOffset = trailing === "notes" ? 4 : 0;
    const state = initial.apply(
      initial.tr.setSelection(
        TextSelection.create(
          initial.doc,
          quote.nodeSize + 1 + outsideTextOffset,
        ),
      ),
    );
    const before = state.doc.toJSON();
    const { handled, nextState } = pressArrow(state, "up");

    assert.equal(handled, true);
    assert.deepEqual(nextState.doc.toJSON(), before);
    assert.equal(nextState.selection.$from.depth, 2);
    assert.equal(nextState.selection.$from.node(1), nextState.doc.child(0));
    assert.equal(nextState.selection.$from.parentOffset, "quoted text".length);
  });
}

test("ArrowUp keeps native movement below the first visual line", () => {
  const initial = createQuoteState({ trailing: "notes" });
  const quote = initial.doc.child(0);
  const state = initial.apply(
    initial.tr.setSelection(TextSelection.create(initial.doc, quote.nodeSize + 5)),
  );
  const before = state.doc.toJSON();
  const { handled, nextState } = pressArrow(state, "up", false);

  assert.equal(handled, false);
  assert.deepEqual(nextState.doc.toJSON(), before);
  assert.equal(nextState.selection.eq(state.selection), true);
});

test("ArrowUp only enters a quote from the first content in a following container", () => {
  const quote = schema.nodes.blockquote.create(
    { replyQuote: false },
    schema.nodes.paragraph.create(null, schema.text("quoted text")),
  );
  const firstParagraph = schema.nodes.paragraph.create(
    null,
    schema.text("first item"),
  );
  const secondParagraph = schema.nodes.paragraph.create(
    null,
    schema.text("second item"),
  );
  const container = schema.nodes.container.create(null, [
    firstParagraph,
    secondParagraph,
  ]);
  const doc = schema.nodes.doc.create(null, [quote, container]);
  const firstState = EditorState.create({
    doc,
    selection: TextSelection.create(doc, quote.nodeSize + 2),
  });
  const firstResult = pressArrow(firstState, "up");

  assert.equal(firstResult.handled, true);
  assert.equal(
    firstResult.nextState.selection.$from.node(1),
    firstResult.nextState.doc.child(0),
  );

  const secondParagraphStart = quote.nodeSize + firstParagraph.nodeSize + 2;
  const state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, secondParagraphStart),
  });
  const before = state.doc.toJSON();
  const { handled, nextState } = pressArrow(state, "up");

  assert.equal(handled, false);
  assert.deepEqual(nextState.doc.toJSON(), before);
  assert.equal(nextState.selection.eq(state.selection), true);
});

test("only normal comment replies receive the reply-quote marker", () => {
  const { wrapBlockQuote } = loadTypescriptModule(
    path.join(root, "src/utils/helperFunctions/TaskDetail/index.ts"),
    {
      "@/models/model": {},
      "@/lib/richText/replyQuote": replyQuoteConstants,
      "@/utils/htmlEscape": {
        escapeHtml: (value) =>
          String(value)
            .replaceAll("&", "&amp;")
            .replaceAll('"', "&quot;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;"),
      },
    },
  );
  const quoter = { id: 7, displayName: "Ada" };

  assert.match(
    wrapBlockQuote("<p>quoted</p>", quoter),
    /<blockquote data-quote-reply="true">/,
  );
  assert.doesNotMatch(
    wrapBlockQuote("<p>quoted</p>", quoter, true),
    /data-quote-reply/,
  );
});

test("the editor registers the reply-aware blockquote exactly once", () => {
  const tiptap = fs.readFileSync(
    path.join(root, "src/components/RTE/Tiptap.ts"),
    "utf8",
  );
  assert.match(tiptap, /import \{ ReplyBlockquote \} from/);
  assert.match(tiptap, /\n\s*ReplyBlockquote,/);
  assert.doesNotMatch(tiptap, /import Blockquote from/);
});

test("the real Tiptap keymap recognizes tagged and legacy replies without changing manual quotes", () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const browserGlobals = {
    window: dom.window,
    document: dom.window.document,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    MutationObserver: dom.window.MutationObserver,
    DOMParser: dom.window.DOMParser,
    KeyboardEvent: dom.window.KeyboardEvent,
    navigator: dom.window.navigator,
    getSelection: dom.window.getSelection.bind(dom.window),
    requestAnimationFrame: (callback) => setTimeout(callback, 0),
  };
  const previousGlobals = new Map(
    Object.keys(browserGlobals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  for (const [key, value] of Object.entries(browserGlobals)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }

  const { Editor } = require("@tiptap/core");
  const StarterKit = require("@tiptap/starter-kit").default;
  const { ReplyBlockquote } = loadTypescriptModule(
    path.join(root, "src/components/RTE/Extensions/ReplyBlockquote.ts"),
    { "@/lib/richText/replyQuote": replyQuoteConstants },
  );
  const pressRealEnter = (editor) =>
    editor.view.someProp("handleKeyDown", (handler) =>
      handler(editor.view, new dom.window.KeyboardEvent("keydown", {
        key: "Enter",
      })),
    );
  const pressRealArrow = (editor, key) =>
    editor.view.someProp("handleKeyDown", (handler) =>
      handler(editor.view, new dom.window.KeyboardEvent("keydown", { key })),
    );

  try {
    const replyEditor = new Editor({
      extensions: [
        StarterKit.configure({ blockquote: false }),
        ReplyBlockquote,
      ],
      content:
        '<blockquote data-quote-reply="true"><p>quoted</p></blockquote>',
    });
    assert.equal(replyEditor.getJSON().content[0].attrs.replyQuote, true);
    const replyBefore = replyEditor.state.doc.child(0).toJSON();
    replyEditor.commands.setTextSelection(3);
    assert.equal(pressRealEnter(replyEditor), true);
    assert.deepEqual(replyEditor.state.doc.child(0).toJSON(), replyBefore);
    assert.equal(replyEditor.state.selection.$from.depth, 1);
    assert.equal(replyEditor.state.selection.$from.parent.type.name, "paragraph");
    replyEditor.destroy();

    const legacyReplyEditor = new Editor({
      extensions: [
        StarterKit.configure({ blockquote: false }),
        ReplyBlockquote,
      ],
      content:
        '<p><span data-type="mention" class="mention" data-id="Ada" data-label="name-7" uniqueindex="" projectid="">Ada</span> said </p><blockquote><p>legacy quoted reply</p></blockquote>',
    });
    assert.equal(
      legacyReplyEditor.getJSON().content[1].attrs.replyQuote,
      true,
    );
    assert.match(
      legacyReplyEditor.getHTML(),
      /<blockquote data-quote-reply="true">/,
    );
    const legacyReplyBefore = legacyReplyEditor.state.doc.child(1).toJSON();
    let legacyQuotePosition = -1;
    legacyReplyEditor.state.doc.descendants((node, position) => {
      if (node.isText && node.text === "legacy quoted reply") {
        legacyQuotePosition = position;
      }
    });
    assert.notEqual(legacyQuotePosition, -1);
    legacyReplyEditor.commands.setTextSelection(legacyQuotePosition + 2);
    assert.equal(pressRealEnter(legacyReplyEditor), true);
    assert.deepEqual(
      legacyReplyEditor.state.doc.child(1).toJSON(),
      legacyReplyBefore,
    );
    assert.equal(legacyReplyEditor.state.selection.$from.depth, 1);
    assert.equal(
      legacyReplyEditor.state.selection.$from.parent.type.name,
      "paragraph",
    );
    legacyReplyEditor.destroy();

    const nestedReplyEditor = new Editor({
      extensions: [
        StarterKit.configure({ blockquote: false }),
        ReplyBlockquote,
      ],
      content:
        '<blockquote data-quote-reply="true"><p>newer quote</p><blockquote data-quote-reply="true"><p>older quote</p></blockquote></blockquote>',
    });
    const nestedReplyBefore = nestedReplyEditor.state.doc.child(0).toJSON();
    let olderQuotePosition = -1;
    nestedReplyEditor.state.doc.descendants((node, position) => {
      if (node.isText && node.text === "older quote") {
        olderQuotePosition = position;
      }
    });
    assert.notEqual(olderQuotePosition, -1);
    nestedReplyEditor.commands.setTextSelection(olderQuotePosition + 2);
    assert.equal(pressRealEnter(nestedReplyEditor), true);
    assert.deepEqual(
      nestedReplyEditor.state.doc.child(0).toJSON(),
      nestedReplyBefore,
    );
    assert.equal(nestedReplyEditor.state.selection.$from.depth, 1);
    assert.equal(
      nestedReplyEditor.state.selection.$from.parent.type.name,
      "paragraph",
    );
    nestedReplyEditor.destroy();

    const manualEditor = new Editor({
      extensions: [
        StarterKit.configure({ blockquote: false }),
        ReplyBlockquote,
      ],
      content: "<blockquote><p>manual quote</p></blockquote>",
    });
    assert.equal(manualEditor.getJSON().content[0].attrs.replyQuote, false);
    manualEditor.commands.setTextSelection(3);
    assert.equal(pressRealEnter(manualEditor), true);
    assert.equal(manualEditor.state.selection.$from.depth, 2);
    assert.equal(
      manualEditor.state.selection.$from.node(1).type.name,
      "blockquote",
    );
    manualEditor.destroy();

    const manualArrowEditor = new Editor({
      extensions: [
        StarterKit.configure({ blockquote: false }),
        ReplyBlockquote,
      ],
      content: "<blockquote><p>manual quote</p></blockquote><p>after quote</p>",
    });
    manualArrowEditor.view.endOfTextblock = () => true;
    const manualArrowQuote = manualArrowEditor.state.doc.child(0);
    manualArrowEditor.commands.setTextSelection(
      manualArrowQuote.nodeSize - 2,
    );
    assert.equal(pressRealArrow(manualArrowEditor, "ArrowDown"), true);
    assert.equal(
      manualArrowEditor.state.selection.$from.parent,
      manualArrowEditor.state.doc.child(1),
    );
    assert.equal(manualArrowEditor.state.selection.$from.parentOffset, 0);
    assert.equal(pressRealArrow(manualArrowEditor, "ArrowUp"), true);
    assert.equal(manualArrowEditor.state.selection.$from.depth, 2);
    assert.equal(
      manualArrowEditor.state.selection.$from.node(1),
      manualArrowEditor.state.doc.child(0),
    );
    assert.equal(
      manualArrowEditor.state.selection.$from.parentOffset,
      "manual quote".length,
    );
    manualArrowEditor.destroy();

    const manualQuoteNearMentionEditor = new Editor({
      extensions: [
        StarterKit.configure({ blockquote: false }),
        ReplyBlockquote,
      ],
      content:
        '<p><span data-type="mention" class="mention" data-id="Ada" data-label="name-7" uniqueindex="" projectid="">Ada</span> mentioned this earlier</p><blockquote><p>manual quote near mention text</p></blockquote>',
    });
    assert.equal(
      manualQuoteNearMentionEditor.getJSON().content[1].attrs.replyQuote,
      false,
    );
    let manualQuotePosition = -1;
    manualQuoteNearMentionEditor.state.doc.descendants((node, position) => {
      if (node.isText && node.text === "manual quote near mention text") {
        manualQuotePosition = position;
      }
    });
    assert.notEqual(manualQuotePosition, -1);
    manualQuoteNearMentionEditor.commands.setTextSelection(
      manualQuotePosition + 2,
    );
    assert.equal(pressRealEnter(manualQuoteNearMentionEditor), true);
    assert.equal(manualQuoteNearMentionEditor.state.selection.$from.depth, 2);
    assert.equal(
      manualQuoteNearMentionEditor.state.selection.$from.node(1).type.name,
      "blockquote",
    );
    manualQuoteNearMentionEditor.destroy();

    const legacyAiQuoteEditor = new Editor({
      extensions: [
        StarterKit.configure({ blockquote: false }),
        ReplyBlockquote,
      ],
      content:
        '<p><span data-type="mention" class="mention" data-id="7" data-label="name" uniqueindex="" projectid="" text="Ada">Ada</span> said </p><blockquote><p>legacy AI quote</p></blockquote>',
    });
    assert.equal(
      legacyAiQuoteEditor.getJSON().content[1].attrs.replyQuote,
      false,
    );
    legacyAiQuoteEditor.destroy();
  } finally {
    for (const [key, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
});
