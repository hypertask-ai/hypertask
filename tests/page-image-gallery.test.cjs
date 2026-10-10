const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const flagKey = "htpr-6872-page-image-gallery";
let enabled = true;
let pathname = "/page/example";
let editor;
let galleryProps;
let focusCount;
let returnCount;
const noop = () => {};
const canvasHtml = '<img src="https://files.hypertask.app/canvas-one.png"><img src="https://files.hypertask.app/canvas-two.jpg">';
const mocks = {
  "lucide-react": { ChevronLeft: () => null, Trash2: () => null },
  "next/navigation": { useRouter: () => ({}), usePathname: () => pathname },
  "react-hot-toast": { default: { error: noop } },
  "@/hooks/useFlag": { useFlag: (key) => key === flagKey && enabled },
  "@/hooks/General/useContentZoom": { useContentZoom: () => ({ zoom: 1, showIndicator: false }) },
  "@/hooks/General/useDebounceWithCancel": { default: () => [noop, noop, noop] },
  "@/lib/constants/APIRouteConstants": { pageRoute: () => "/api/pages/example" },
  "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
  "@/lib/state": { useRecoilValue: () => ({ show: false }), useSetRecoilState: () => noop },
  "@/lib/configs/general.config": { MOBILE_TARGET: 768 },
  "@/utils/undoActions/helperFuncs": { cn: (...names) => names.filter(Boolean).join(" ") },
  "@/store/currentPageActions": { currentPageActionsAtom: {} },
  "@/store": {},
  "@/styles/tiptap.module.scss": { default: {} },
  "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail": { default: () => null },
  "@/components/RTE/Components/DragHandleTiptap": { default: () => null },
  "@/components/RTE/Components/TiptapBubbleMenu": { default: () => null },
  "@/components/RTE/Tiptap": { default: () => ({ editor }) },
};

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
mocks["@/lib/navigation/pageReturn"] = {
  ...load("src/lib/navigation/pageReturn.ts"),
  bindPageReturnEntry: noop,
  returnFromPage: () => { returnCount += 1; },
};
const { buildHtmlBlockSrcDoc } = load("src/components/RTE/Extensions/HtmlBlock/buildSrcDoc.ts");
mocks["./buildSrcDoc"] = { buildHtmlBlockSrcDoc };
const { HtmlCanvasFrame } = load("src/components/RTE/Extensions/HtmlBlock/HtmlCanvasFrame.tsx");
mocks["next/dynamic"] = { default: (loader) => {
  if (!loader.toString().includes("AttachmentsCarousel")) return () => null;
  return (props) => {
    galleryProps = props;
    return React.createElement("button", { "data-gallery-close": true, onClick: props.closeCallback }, "Close gallery");
  };
} };
mocks["@tiptap/react"] = { EditorContent: () => React.createElement("div", {
  className: "ProseMirror", contentEditable: editor.isEditable, suppressContentEditableWarning: true,
},
React.createElement("img", { "data-image": "first", src: "https://files.hypertask.app/first.png" }),
React.createElement("img", { className: "ProseMirror-separator", "data-separator": true }),
React.createElement("div", { className: "horizontal-resize-handle" }, "Resize"),
React.createElement("button", { "data-media-control": true }, "Align"),
React.createElement("div", { "data-figma-embed-preview": true }, React.createElement("img", { src: "https://files.hypertask.app/figma.png" })),
React.createElement("div", { className: "ht-html-block" }, React.createElement(HtmlCanvasFrame, { html: canvasHtml })),
React.createElement("img", { "data-image": "last", src: "https://files.hypertask.app/last.png" }),
) };
const PageEditor = load("src/app/page/[publicId]/PageEditor.tsx").default;

async function withPage(options, run) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/page/example" });
  const names = ["window", "document", "Element", "HTMLImageElement", "HTMLIFrameElement", "DOMParser", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = names.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]);
  for (const name of names) global[name] = name === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[name];
  enabled = options.enabled ?? true;
  pathname = options.pathname ?? "/page/example";
  focusCount = 0;
  returnCount = 0;
  galleryProps = undefined;
  editor = { isEditable: options.editable ?? true, commands: { focus: () => { focusCount += 1; } }, on: noop, off: noop, registerPlugin: noop, unregisterPlugin: noop };
  const reactRoot = createRoot(document.getElementById("root"));
  const click = async (selector, init = {}) => React.act(async () => {
    document.querySelector(selector).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
  });
  const message = async (data, source = document.querySelector("iframe").contentWindow) => React.act(async () => {
    window.dispatchEvent(new dom.window.MessageEvent("message", { data, source }));
  });
  try {
    await React.act(async () => reactRoot.render(React.createElement(PageEditor, {
      _page: JSON.stringify({ publicId: "example", title: "Test", contentHtml: "", version: 1, taskId: 23, projectId: 15, task: { projectId: 15, uniqueIndex: 6872 } }),
      _user: JSON.stringify({ displayName: "QA" }),
    })));
    await run({ dom, click, message });
  } finally {
    await React.act(async () => reactRoot.unmount());
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
  }
}

for (const editable of [false, true]) {
  test(`page image click opens the shared gallery in ${editable ? "edit" : "read"} mode in page order`, async () => {
    await withPage({ editable }, async ({ click }) => {
      await click('[data-image="last"]');
      assert.equal(galleryProps.currentIndex, 3);
      assert.deepEqual(galleryProps.attachments.map((item) => item.fileSource), [
        "https://files.hypertask.app/first.png", "https://files.hypertask.app/canvas-one.png",
        "https://files.hypertask.app/canvas-two.jpg", "https://files.hypertask.app/last.png",
      ]);
      assert.ok(galleryProps.attachments.every((item) => item.taskId === 23));
      assert.equal(focusCount, 0);
      await click("[data-gallery-close]");
      assert.equal(document.querySelector("[data-gallery-close]"), null);
      await click('[data-image="first"]');
      assert.equal(galleryProps.currentIndex, 0);
    });
  });
}

test("flag off keeps editor focus and omits gallery and canvas click bridge", async () => {
  await withPage({ enabled: false }, async ({ click, message }) => {
    await click('[data-image="first"]');
    await message({ __htPageImage: 1, images: ["https://files.hypertask.app/canvas-one.png"], index: 0 });
    assert.equal(galleryProps, undefined);
    assert.equal(focusCount, 1);
    assert.doesNotMatch(document.querySelector("iframe").srcdoc, /__htPageImage/);
  });
});

test("resize handles, editing controls, Figma previews and modified image clicks do not open the gallery", async () => {
  await withPage({}, async ({ click }) => {
    await click(".horizontal-resize-handle");
    await click("[data-media-control]");
    await click("[data-figma-embed-preview] img");
    for (const key of ["shiftKey", "ctrlKey", "metaKey", "altKey"]) await click('[data-image="first"]', { [key]: true });
    await click('[data-image="first"]', { button: 2 });
    assert.equal(galleryProps, undefined);
    assert.equal(focusCount, 7);
  });
});

test("Escape cannot return to the ticket while the gallery is open and works after close", async () => {
  await withPage({}, async ({ dom, click }) => {
    await click('[data-image="first"]');
    await React.act(async () => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(returnCount, 0);
    await click("[data-gallery-close]");
    await React.act(async () => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(returnCount, 1);
  });
});

test("canvas clicks join the page gallery and reject foreign sources and malformed payloads", async () => {
  await withPage({}, async ({ message }) => {
    const images = ["https://files.hypertask.app/canvas-one.png", "https://files.hypertask.app/canvas-two.jpg"];
    const data = { __htPageImage: 1, images, index: 1 };
    await message(data, window);
    for (const invalid of [null, { ...data, images: [42] }, { ...data, index: -1 }, { ...data, index: 2 }, { ...data, index: 0.5 }]) await message(invalid);
    assert.equal(galleryProps, undefined);
    await message(data);
    assert.equal(galleryProps.currentIndex, 2);
    assert.equal(galleryProps.attachments.length, 4);
    assert.equal(galleryProps.attachments[2].fileSource, images[1]);
    assert.equal(document.querySelector("iframe").getAttribute("sandbox"), "allow-scripts");
  });
});

test("canvas bridge is page-only and flag-off output remains the original document", async () => {
  assert.equal(buildHtmlBlockSrcDoc(canvasHtml), buildHtmlBlockSrcDoc(canvasHtml, false));
  await withPage({ pathname: "/detail/project-15/6872" }, async () => {
    assert.doesNotMatch(document.querySelector("iframe").srcdoc, /__htPageImage/);
  });
});

test("sandbox bridge sends actual image order, prevents linked-image navigation and ignores modified clicks", () => {
  const html = '<a href="https://example.com"><img src="https://files.hypertask.app/a.png"></a><img src="https://files.hypertask.app/b.png">';
  const dom = new JSDOM(buildHtmlBlockSrcDoc(html, true), { runScripts: "dangerously", url: "https://app.hypertask.ai/page/example" });
  const messages = [];
  dom.window.parent.postMessage = (data) => messages.push(data);
  try {
    const image = dom.window.document.querySelector("img");
    image.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, ctrlKey: true }));
    assert.equal(messages.length, 0);
    const click = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true });
    image.dispatchEvent(click);
    assert.equal(click.defaultPrevented, true);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].index, 0);
    assert.deepEqual(Array.from(messages[0].images), ["https://files.hypertask.app/a.png", "https://files.hypertask.app/b.png"]);
  } finally {
    dom.window.close();
  }
});

test("page wiring reuses ticket carousel, its navigation, download, Escape and backdrop controls", () => {
  const source = fs.readFileSync(path.join(root, "src/app/page/[publicId]/PageEditor.tsx"), "utf8");
  assert.match(source, /import\("@\/components\/Common\/AttachmentsView\/AttachmentsCarousel"\)/);
  assert.match(source, /galleryEnabled && galleryItems && \(/);
  const gallery = fs.readFileSync(path.join(root, "src/components/Common/AttachmentsView/AttachmentsCarousel.tsx"), "utf8");
  assert.match(gallery, /<Lightbox/);
  assert.match(gallery, /plugins=\{\[Zoom, Download, Fullscreen/);
  assert.match(gallery, /close=\{handleClose\}/);
  assert.match(gallery, /closeOnBackdropClick: true/);
  const flags = (fs.readFileSync(path.join(root, "src/lib/flags.ts"), "utf8") + fs.readFileSync(path.join(root, "src/lib/flags/definitions.ts"), "utf8"));
  assert.match(flags, /key: HTPR_6872_PAGE_IMAGE_GALLERY_FLAG,\s*shippedOn: "2026-10-03"/);
});
