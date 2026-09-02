const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { Schema } = require("@tiptap/pm/model");

const root = path.resolve(__dirname, "..");
const originalCache = new Map(Object.entries(require.cache));
const toastErrors = [];

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
    promise: (request) => request,
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
      content: "text*",
      group: "block",
      toDOM: () => ["p", 0],
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
        editor.isEmpty = false;
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

    await setEditableHtml(
      container.querySelector('[contenteditable="true"]'),
      "<p>Edited draft</p>",
    );
    await click(dom, buttonWithText(container, "Improve readability"));

    assert.equal(requests[0].content, "<p>Edited draft</p>");
    assert.equal(editor.setContentCalls.length, 0);
  });
});

test("mobile Write with AI accepts edits made directly to the isolated proposal", async () => {
  await withRenderedSheet("Original draft", async ({ container, dom, editor, getCloseCalls }) => {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ corrected_html: "<p>AI proposal</p>" }),
    });

    await click(dom, buttonWithText(container, "Improve readability"));
    const proposal = container.querySelector('[contenteditable="true"]');
    await setEditableHtml(proposal, "");
    assert.ok(container.querySelector('[contenteditable="true"]'));
    await setEditableHtml(
      container.querySelector('[contenteditable="true"]'),
      "<p>Edited proposal</p>",
    );
    await click(dom, buttonWithText(container, "Use this text"));

    assert.deepEqual(editor.setContentCalls, ["<p>Edited proposal</p>"]);
    assert.equal(getCloseCalls(), 1);
  });
});

test("mobile Write with AI renders submit, retry, refine, and discard without replacing the composer", async () => {
  await withRenderedSheet("", async ({ container, dom, editor, getCloseCalls }) => {
    const requests = [];
    global.fetch = async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({ corrected_html: `<p>Proposal ${requests.length}</p>` }),
      };
    };

    let input = container.querySelector("input");
    await setInput(dom, input, "Draft a concise reply");
    await click(dom, container.querySelector('[aria-label="Send AI instruction"]'));

    assert.equal(requests[0].command, "WriteContent");
    assert.equal(requests[0].content, "");
    assert.equal(editor.setContentCalls.length, 0);
    assert.match(container.textContent, /Proposal 1/);

    await click(dom, buttonWithText(container, "Try again"));
    assert.deepEqual(requests[1], requests[0]);
    assert.match(container.textContent, /Proposal 2/);

    await click(dom, buttonWithText(container, "Refine…"));
    input = container.querySelector("input");
    await setInput(dom, input, "Make it warmer");
    await click(dom, container.querySelector('[aria-label="Send AI instruction"]'));
    assert.equal(requests[2].command, "CustomEdit");
    assert.equal(requests[2].content, "<p>Proposal 2</p>");
    assert.equal(requests[2].instruction, "Make it warmer");
    assert.equal(editor.setContentCalls.length, 0);

    await click(dom, buttonWithText(container, "Discard"));
    assert.equal(getCloseCalls(), 1);
    assert.equal(editor.setContentCalls.length, 0);
  });
});

test("mobile Write with AI accepts only against the unchanged opening draft", async () => {
  await withRenderedSheet("Original draft", async ({ container, dom, editor, getCloseCalls }) => {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ corrected_html: "<p>Accepted proposal</p>" }),
    });

    await click(dom, buttonWithText(container, "Improve readability"));
    assert.equal(editor.setContentCalls.length, 0);
    await click(dom, buttonWithText(container, "Use this text"));
    assert.deepEqual(editor.setContentCalls, ["<p>Accepted proposal</p>"]);
    assert.equal(getCloseCalls(), 1);
  });

  toastErrors.length = 0;
  await withRenderedSheet("Original draft", async ({ container, dom, editor, getCloseCalls }) => {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ corrected_html: "<p>Stale proposal</p>" }),
    });

    await click(dom, buttonWithText(container, "Improve readability"));
    editor.state.doc = schema.node("doc", null, [paragraph("Changed externally")]);
    await click(dom, buttonWithText(container, "Use this text"));
    assert.equal(editor.setContentCalls.length, 0);
    assert.equal(getCloseCalls(), 0);
    assert.match(toastErrors.at(-1), /changed while AI was working/);
  });
});
