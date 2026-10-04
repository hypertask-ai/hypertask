const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const { Editor } = require("@tiptap/core");
const { StarterKit } = require("@tiptap/starter-kit");
const { Plugin, PluginKey } = require("@tiptap/pm/state");
const extensions = [StarterKit];

const root = path.resolve(__dirname, "..");
const noop = () => {};
let editor;
let router;
let commandCenterOpen;
let flushes;
const mocks = {
  "lucide-react": { ArrowLeft: () => null, ChevronLeft: () => null, Trash2: () => null },
  "next/navigation": { useRouter: () => router },
  "next/dynamic": { default: () => () => null },
  "react-hot-toast": { default: { error: noop } },
  "@/hooks/useFlag": { useFlag: () => false },
  "@/hooks/General/useContentZoom": { useContentZoom: () => ({ zoom: 1, showIndicator: false }) },
  "@/hooks/General/useDebounceWithCancel": { default: () => [noop, noop, () => { flushes += 1; }] },
  "@/lib/constants/APIRouteConstants": { pageRoute: () => "/api/pages/example" },
  "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
  "@/lib/state": { useRecoilValue: () => ({ show: commandCenterOpen }), useSetRecoilState: () => noop },
  "@/lib/configs/general.config": { MOBILE_TARGET: 768 },
  "@/utils/undoActions/helperFuncs": { cn: (...names) => names.filter(Boolean).join(" ") },
  "@/store/currentPageActions": { currentPageActionsAtom: {} },
  "@/store": {},
  "@/styles/tiptap.module.scss": { default: {} },
  "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail": { default: () => null },
  "@/components/RTE/Components/DragHandleTiptap": { default: () => null },
  "@/components/RTE/Components/TiptapBubbleMenu": { default: () => null },
  "@/components/RTE/Tiptap": { default: () => ({ editor }) },
  "@tiptap/react": { EditorContent: () => React.createElement("div", {
    ref: node => { if (node) node.append(editor.view.dom); },
  }) },
};

// Run the real page component and navigation helpers, mocking only external UI/hooks.
function load(relativePath) {
  const target = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, relativePath), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function("require", "module", "exports", compiled)(
    (specifier) => specifier in mocks ? { __esModule: true, ...mocks[specifier] } : require(specifier), target, target.exports,
  );
  return target.exports;
}
mocks["@/lib/flags/keys"] = load("src/lib/flags/keys.ts");
mocks["@/utils/helperFunctions/isContentCarouselImage"] = load("src/utils/helperFunctions/isContentCarouselImage.ts");
const pageReturn = load("src/lib/navigation/pageReturn.ts");
mocks["@/lib/navigation/pageReturn"] = pageReturn;
const PageEditor = load("src/app/page/[publicId]/PageEditor.tsx").default;

async function withPage(options, run) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/page/example" });
  const names = ["window", "document", "navigator", "Element", "HTMLElement", "Node", "MutationObserver", "getComputedStyle", "HTMLImageElement", "HTMLIFrameElement", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = names.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]);
  for (const name of names) Object.defineProperty(global, name, {
    configurable: true, value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[name],
  });
  dom.window.Range.prototype.getClientRects = () => [];
  dom.window.Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
  const calls = [];
  router = { back: () => calls.push(["back"]), replace: (href) => calls.push(["replace", href]) };
  commandCenterOpen = options.commandCenterOpen ?? false;
  flushes = 0;
  editor = new Editor({ element: document.createElement("div"), extensions, content: "<p>Page text</p>" });
  if (options.internal) {
    const href = pageReturn.createPageReturnHref({
      pageHref: "/page/example", taskHref: "/detail/project-15/6903",
      sourceHref: "https://app.hypertask.ai/detail/project-15/6903?inboxFlow=true#comment-1",
      currentOrigin: dom.window.location.origin, storage: dom.window.sessionStorage,
      runtime: dom.window, nonce: "page-return-nonce-6903",
    });
    dom.window.history.replaceState({}, "", href);
  }
  const reactRoot = createRoot(document.getElementById("root"));
  const press = async (target = document.body, init = {}) => {
    const event = new dom.window.KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true, cancelable: true, ...init });
    await React.act(async () => target.dispatchEvent(event));
    return event;
  };
  try {
    await React.act(async () => reactRoot.render(React.createElement(PageEditor, {
      _page: JSON.stringify({ publicId: "example", title: "Test", contentHtml: "", version: 1, taskId: 23, projectId: 15, task: { projectId: 15, uniqueIndex: 6903 } }),
      _user: JSON.stringify({ displayName: "QA" }),
    })));
    await run({ dom, calls, press });
  } finally {
    await React.act(async () => reactRoot.unmount());
    editor?.destroy();
    const callsBeforeUnmountedEscape = calls.length;
    await press();
    assert.equal(calls.length, callsBeforeUnmountedEscape, "unmount removes the page shortcut");
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
  }
}

for (const internal of [false, true]) {
  test(`page Escape uses the back button helper and flushes saves (${internal ? "task entry" : "direct entry"})`, async () => {
    await withPage({ internal }, async ({ calls, press }) => {
      await press();
      assert.deepEqual(calls, internal ? [["back"]] : [["replace", "/detail/project-15/6903"]]);
      assert.equal(flushes, 2);
    });
  });
}

test("first Escape blurs the page editor, second Escape goes back", async () => {
  await withPage({}, async ({ calls, press }) => {
    const prose = document.querySelector(".ProseMirror");
    prose.focus();
    await press(prose.querySelector("p"));
    assert.deepEqual(calls, []);
    assert.equal(document.activeElement.tagName, "BODY");
    await press();
    assert.deepEqual(calls, [["replace", "/detail/project-15/6903"]]);
  });
});

for (const markup of ['<input>', '<textarea></textarea>', '<div contenteditable="true" tabindex="0"></div>', '<div role="textbox" tabindex="0"></div>']) {
  test(`Escape leaves a focused input without navigating: ${markup}`, async () => {
    await withPage({}, async ({ calls, press }) => {
      const holder = document.createElement("div");
      holder.innerHTML = markup;
      document.body.append(holder);
      holder.firstChild.focus();
      await press(holder.firstChild);
      assert.deepEqual(calls, []);
      assert.equal(document.activeElement.tagName, "BODY");
    });
  });
}

for (const markup of ['<div class="modal show"></div>', '<div role="dialog"></div>', '<div role="menu"></div>', '<div role="listbox"></div>', '<div class="tippy-box" data-state="visible"></div>', '<div data-radix-popper-content-wrapper></div>']) {
  test(`an open layer owns Escape: ${markup}`, async () => {
    await withPage({}, async ({ calls, press }) => {
      const holder = document.createElement("div");
      holder.innerHTML = markup;
      document.body.append(holder);
      await press();
      assert.deepEqual(calls, []);
      assert.equal(flushes, 0);
    });
  });
}

test("command center owns Escape", async () => {
  await withPage({ commandCenterOpen: true }, async ({ calls, press }) => {
    await press();
    assert.deepEqual(calls, []);
  });
});

test("a later document listener consuming Escape prevents page navigation", async () => {
  await withPage({}, async ({ calls, press }) => {
    const consume = event => event.preventDefault();
    document.addEventListener("keydown", consume);
    await press();
    document.removeEventListener("keydown", consume);
    assert.deepEqual(calls, []);
  });
});

test("slash menu consuming Escape does not blur the editor or navigate", async () => {
  await withPage({}, async ({ calls, press }) => {
    const prose = document.querySelector(".ProseMirror");
    prose.focus();
    editor.registerPlugin(new Plugin({
      key: new PluginKey("testSlashMenu"),
      props: { handleKeyDown: (_view, event) => event.key === "Escape" },
    }), (plugin, plugins) => [plugin, ...plugins]);
    await press(prose);
    assert.equal(document.activeElement, prose);
    assert.deepEqual(calls, []);
  });
});

test("composition and other keys never navigate", async () => {
  await withPage({}, async ({ calls, press }) => {
    await press(document.body, { isComposing: true });
    await press(document.body, { key: "Enter" });
    assert.deepEqual(calls, []);
  });
});
