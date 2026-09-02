const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { DOMParser: ProseMirrorDOMParser, Schema } = require("@tiptap/pm/model");

const root = path.resolve(__dirname, "..");
const originalCache = new Map(Object.entries(require.cache));
const toastErrors = [];
const toastSuccesses = [];

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

stubModule(require.resolve("react-hot-toast"), {
  default: {
    dismiss: () => {},
    error: (message) => toastErrors.push(message),
    loading: () => {},
    promise: (request) => request,
    success: (message) => toastSuccesses.push(message),
  },
});
stubSourceModule("src/components/Common/SendArrow.tsx", {
  SendArrow: () => React.createElement("span", null, "send"),
});
stubSourceModule("src/components/RTE/Components/AudioButton.tsx", {
  AudioButton: () => React.createElement("button", { type: "button" }, "mic"),
});
stubSourceModule("src/components/Modals/Sheets/AppSheet.tsx", {
  AppSheet: ({ children }) => React.createElement("div", null, children),
});
stubSourceModule("src/components/Modals/Sheets/mobileOverlayAppSheetStyles.ts", {
  MOBILE_OVERLAY_SHEET_Z: 1,
  mobileOverlayAppSheetBodyClass: "body",
  mobileOverlayAppSheetHandleBarClass: "bar",
  mobileOverlayAppSheetHandleHeaderClass: "header",
  mobileOverlayAppSheetHandleRowClass: "row",
  mobileOverlayAppSheetPanelClass: "panel",
});
stubSourceModule("src/hooks/General/useMobileVisualViewport.ts", {
  useMobileVisualViewport: () => null,
});
stubSourceModule("src/lib/mobileCommentViewport.ts", {
  getMobileOverlaySheetContainerStyle: () => undefined,
});
stubSourceModule("src/styles/tiptap.module.scss", {
  editorContainer: "editor-container",
  is_editor_empty: "is-editor-empty",
});
stubSourceModule("src/utils/helperFunctions/sanitizeHtml.ts", {
  sanitizeAiHtml: (html) => html,
});

const jiti = require("jiti")(__filename, {
  interopDefault: true,
  jsx: true,
  alias: { "@": path.join(root, "src") },
});
const inlineDraftAiModule = jiti(
  path.join(root, "src/components/RTE/Components/InlineDraftAiFloat.tsx"),
);
const InlineDraftAiFloat = inlineDraftAiModule.default ?? inlineDraftAiModule;
const { syncMobileEditableSurface } = inlineDraftAiModule;

for (const filename of Object.keys(require.cache)) {
  if (!originalCache.has(filename)) delete require.cache[filename];
}
for (const [filename, cachedModule] of originalCache) {
  require.cache[filename] = cachedModule;
}

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    horizontal_rule: {
      atom: true,
      group: "block",
      parseDOM: [{ tag: "hr" }],
      toDOM: () => ["hr"],
    },
    hard_break: {
      group: "inline",
      inline: true,
      parseDOM: [{ tag: "br" }],
      toDOM: () => ["br"],
    },
    text: { group: "inline" },
  },
});
const paragraph = (text) =>
  schema.node("paragraph", null, text ? [schema.text(text)] : []);

function createEditor(text = "") {
  const documentNode = schema.node("doc", null, [paragraph(text)]);
  const editor = {
    isEditable: true,
    isEmpty: !text,
    schema,
    state: {
      doc: documentNode,
      selection: text
        ? { from: 0, to: documentNode.content.size }
        : { from: 1, to: 1 },
    },
    setContentCalls: [],
    handlers: new Map(),
    view: { dom: global.document.createElement("div") },
    commands: {
      focus: () => true,
      selectAll: () => {
        editor.state.selection = { from: 0, to: editor.state.doc.content.size };
        return true;
      },
      setContent: (html) => {
        editor.setContentCalls.push(html);
        const element = global.document.createElement("div");
        element.innerHTML = html;
        editor.state.doc = ProseMirrorDOMParser.fromSchema(schema).parse(element);
        editor.isEmpty = !element.textContent.trim() && !element.querySelector("hr");
        return true;
      },
      setTextSelection: (range) => {
        editor.state.selection =
          typeof range === "number" ? { from: range, to: range } : { ...range };
        return true;
      },
      unsetHighlight: () => true,
    },
    chain: () => ({
      focus: () => editor.chain(),
      insertContentAt: () => editor.chain(),
      run: () => true,
    }),
    on: (event, handler) => editor.handlers.set(event, handler),
    off: (event) => editor.handlers.delete(event),
    setEditable: (editable) => {
      editor.isEditable = editable;
    },
  };
  return editor;
}

const buttonWithText = (container, text) =>
  [...container.querySelectorAll("button")].find(
    (button) => button.textContent.trim() === text,
  );

async function setInput(_dom, input, value) {
  const propsKey = Object.keys(input).find((key) =>
    key.startsWith("__reactProps$"),
  );
  assert.ok(propsKey);
  await act(async () => {
    input[propsKey].onChange({ target: { value } });
  });
}

async function setEditableHtml(element, html) {
  assert.ok(element);
  const propsKey = Object.keys(element).find((key) =>
    key.startsWith("__reactProps$"),
  );
  assert.ok(propsKey);
  element.innerHTML = html;
  await act(async () => {
    element[propsKey].onInput({ currentTarget: element });
  });
}

async function click(dom, element) {
  assert.ok(element);
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

async function withRenderedSheet(text, callback) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://app.hypertask.ai/detail/project-15/5865",
  });
  const previous = {
    window: global.window,
    document: global.document,
    navigator: global.navigator,
    React: global.React,
    fetch: global.fetch,
    requestAnimationFrame: global.requestAnimationFrame,
    actEnvironment: global.IS_REACT_ACT_ENVIRONMENT,
  };
  global.window = dom.window;
  global.document = dom.window.document;
  global.navigator = dom.window.navigator;
  global.React = React;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  global.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  dom.window.requestAnimationFrame = global.requestAnimationFrame;
  dom.window.HTMLElement.prototype.attachEvent = () => {};
  dom.window.HTMLElement.prototype.detachEvent = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};

  const editor = createEditor(text);
  const container = document.getElementById("root");
  const reactRoot = createRoot(container);
  let closeCalls = 0;
  try {
    await act(async () => {
      reactRoot.render(
        React.createElement(InlineDraftAiFloat, {
          editor,
          onClose: () => {
            closeCalls += 1;
          },
          presentation: "composer",
          suppressEditorSelectionHighlight: true,
        }),
      );
    });
    await callback({
      container,
      dom,
      editor,
      getCloseCalls: () => closeCalls,
    });
  } finally {
    await act(async () => reactRoot.unmount());
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) {
      const globalKey = key === "actEnvironment" ? "IS_REACT_ACT_ENVIRONMENT" : key;
      if (value === undefined) delete global[globalKey];
      else global[globalKey] = value;
    }
  }
}

test("mobile Write with AI matches the empty mobile composer state", async () => {
  await withRenderedSheet("", async ({ container }) => {
    const heading = [...container.querySelectorAll("h2")].find(
      (element) => element.textContent.trim() === "Write with AI",
    );
    const icon = heading?.parentElement.querySelector(".lucide-pencil-sparkles");
    assert.equal(icon?.getAttribute("stroke-width"), "1.5");
    assert.equal(container.querySelector('[contenteditable="true"]'), null);

    const prompt = container.querySelector("input");
    assert.equal(prompt.placeholder, "Describe the text you want written…");
    assert.match(container.textContent, /Nothing written yet/);
    assert.match(
      container.textContent,
      /Tell the AI what the comment should say, by voice or keyboard/,
    );
    assert.doesNotMatch(
      container.querySelector("[data-mobile-write-ai-prompt]").className,
      /h-full/,
    );

    await setInput(null, prompt, "Draft a reply");
    const send = container.querySelector('[aria-label="Send AI instruction"]');
    assert.match(send.className, /bg-shadcn-primary/);
    assert.match(send.className, /text-primary-foreground/);
    assert.match(send.className, /rounded-\[4px\]/);
  });
});

test("mobile Write with AI renders the complete existing-draft chip strip", async () => {
  await withRenderedSheet("Original draft", async ({ container, dom }) => {
    const requests = [];
    global.fetch = async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({ corrected_html: "<p>Friendlier draft</p>" }),
      };
    };

    assert.equal(
      container.querySelector("input").placeholder,
      "Describe how to edit the text",
    );
    const strip = container.querySelector(".overflow-x-auto");
    assert.match(strip.className, /shrink-0/);
    assert.deepEqual(
      [...strip.querySelectorAll("button")].map((button) =>
        button.textContent.trim(),
      ),
      [
        "Improve readability",
        "Fix spelling",
        "Simplify",
        "Unslop",
        "Structured",
        "Shorter",
        "Friendlier",
      ],
    );
    for (const button of strip.querySelectorAll("button")) {
      assert.match(button.className, /rounded-\[4px\]/);
      assert.match(button.className, /bg-hover-active/);
    }
    assert.match(
      container.querySelector('[contenteditable="true"]').parentElement.className,
      /flex-1/,
    );

    await click(dom, buttonWithText(container, "Friendlier"));
    assert.equal(requests[0].command, "CustomEdit");
    assert.equal(requests[0].instruction, "Make the tone friendlier.");
  });
});

test("mobile Write with AI does not replace newer typing with an older render", () => {
  const surface = { innerHTML: "<p>Starting draft. Keyboard works.</p>" };
  const pendingInput = { current: surface.innerHTML };

  syncMobileEditableSurface(
    surface,
    "<p>Starting draft. Keybod woks.</p>",
    "<p>Starting draft. Keybod woks.</p>",
    pendingInput,
  );

  assert.equal(surface.innerHTML, "<p>Starting draft. Keyboard works.</p>");
  assert.equal(pendingInput.current, "<p>Starting draft. Keyboard works.</p>");

  syncMobileEditableSurface(
    surface,
    pendingInput.current,
    pendingInput.current,
    pendingInput,
  );
  assert.equal(pendingInput.current, null);

  syncMobileEditableSurface(
    surface,
    "<p>AI replacement</p>",
    "<p>AI replacement</p>",
    pendingInput,
  );
  assert.equal(surface.innerHTML, "<p>AI replacement</p>");
});

test("mobile Write with AI keeps an edited existing draft as the rewrite source", async () => {
  await withRenderedSheet("Original draft", async ({ container, dom, editor }) => {
    const requests = [];
    global.fetch = async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({ corrected_html: "<p>Proposal</p>" }),
      };
    };

    const source = container.querySelector('[contenteditable="true"]');
    await setEditableHtml(
      source,
      '<p class="is-editor-empty" data-placeholder="Nothing written yet.">Edited draft</p>',
    );
    source.focus();
    assert.equal(document.activeElement, source);
    await click(dom, buttonWithText(container, "Improve readability"));

    assert.equal(requests[0].content, "<p>Edited draft</p>");
    assert.match(container.textContent, /Proposal/);
    assert.doesNotMatch(container.textContent, /Edited draft/);
    assert.deepEqual(editor.setContentCalls, [
      "<p>Edited draft</p>",
      "<p>Proposal</p>",
    ]);
  });
});

test("mobile Write with AI keeps an empty edited draft open without inert chips", async () => {
  await withRenderedSheet("Original draft", async ({ container }) => {
    await setEditableHtml(container.querySelector('[contenteditable="true"]'), "");

    assert.ok(container.querySelector('[contenteditable="true"]'));
    assert.match(container.textContent, /Your draft · tap to edit/i);
    assert.equal(container.querySelector(".overflow-x-auto"), null);
  });
});

test("mobile Write with AI preserves atomic rich-text draft content", async () => {
  await withRenderedSheet("Original draft", async ({ container, dom }) => {
    const requests = [];
    global.fetch = async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({ corrected_html: "<p>Proposal</p>" }),
      };
    };

    await setEditableHtml(
      container.querySelector('[contenteditable="true"]'),
      "<hr>",
    );
    await click(dom, buttonWithText(container, "Simplify"));

    assert.equal(requests[0].content, "<hr>");
  });
});

test("first mobile AI generation becomes the editable draft with edit controls", async () => {
  await withRenderedSheet("", async ({ container, dom, editor }) => {
    const requests = [];
    const responses = ["<p>Generated draft</p>", "<p>Short draft</p>"];
    global.fetch = async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({ corrected_html: responses.shift() }),
      };
    };

    await setInput(dom, container.querySelector("input"), "Draft a reply");
    await click(dom, container.querySelector('[aria-label="Send AI instruction"]'));

    assert.equal(requests[0].command, "WriteContent");
    assert.equal(requests[0].content, "");
    assert.equal(
      container.querySelector('[contenteditable="true"]').innerHTML,
      "<p>Generated draft</p>",
    );
    assert.match(container.textContent, /Your draft · tap to edit/i);
    assert.equal(
      container.querySelector("input").placeholder,
      "Describe how to edit the text",
    );
    assert.deepEqual(
      [...container.querySelector(".overflow-x-auto").querySelectorAll("button")].map(
        (button) => button.textContent.trim(),
      ),
      [
        "Improve readability",
        "Fix spelling",
        "Simplify",
        "Unslop",
        "Structured",
        "Shorter",
        "Friendlier",
      ],
    );
    assert.doesNotMatch(container.textContent, /AI proposal|Try again|Use this text/i);
    assert.deepEqual(editor.setContentCalls, ["<p>Generated draft</p>"]);

    await click(dom, buttonWithText(container, "Shorter"));
    assert.equal(requests[1].content, "<p>Generated draft</p>");
    assert.equal(
      container.querySelector('[contenteditable="true"]').innerHTML,
      "<p>Short draft</p>",
    );
    assert.deepEqual(editor.setContentCalls, [
      "<p>Generated draft</p>",
      "<p>Short draft</p>",
    ]);
  });
});

test("mobile Write with AI keeps a newer draft when an AI response becomes stale", async () => {
  toastErrors.length = 0;
  toastSuccesses.length = 0;
  await withRenderedSheet("Original draft", async ({ container, dom, editor }) => {
    let resolveResponse;
    global.fetch = () =>
      new Promise((resolve) => {
        resolveResponse = resolve;
      });

    await click(dom, buttonWithText(container, "Improve readability"));
    editor.state.doc = schema.node("doc", null, [paragraph("Changed externally")]);
    await act(async () => {
      resolveResponse({
        ok: true,
        json: async () => ({ corrected_html: "<p>Stale draft</p>" }),
      });
      await new Promise((resolve) => setImmediate(resolve));
    });

    assert.equal(editor.setContentCalls.length, 0);
    assert.match(toastErrors.at(-1), /newer draft was preserved/);
    assert.deepEqual(toastSuccesses, []);
  });
});
