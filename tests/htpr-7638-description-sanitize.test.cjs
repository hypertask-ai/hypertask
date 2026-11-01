const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const { createJiti } = require("jiti");
const { DOMSerializer } = require("@tiptap/pm/model");
const purifier = require("isomorphic-dompurify");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") } });
const { sanitizeDescriptionHtml, sanitizeAiHtml } = jiti(path.join(root, "src/utils/helperFunctions/sanitizeHtml.ts"));
const descriptionDir = "src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/";
const noop = () => {};

function load(file, mocks = {}, extra = "") {
  const source = fs.readFileSync(path.join(root, file), "utf8") + extra;
  const compiled = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)((specifier) => {
    if (specifier in mocks) return { __esModule: true, ...mocks[specifier] };
    if (specifier.endsWith(".scss")) return { __esModule: true, default: {} };
    if (specifier.startsWith("@/")) return jiti(path.join(root, "src", specifier.slice(2)));
    if (specifier.startsWith(".")) return jiti(path.resolve(root, path.dirname(file), specifier));
    return require(specifier);
  }, loaded, loaded.exports);
  return loaded.exports;
}

function withDom(t) {
  const dom = new JSDOM("", { url: "https://app.hypertask.ai" });
  const previous = new Map();
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser,
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(global, key));
    Object.defineProperty(global, key, { configurable: true, writable: true, value });
  }
  t.after(() => {
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  });
  return dom.window.document;
}

function assertSafe(root) {
  assert.equal(root.querySelectorAll("script,iframe[srcdoc]").length, 0);
  for (const element of root.querySelectorAll("*")) {
    for (const attribute of element.attributes) assert.ok(!/^on/i.test(attribute.name));
  }
  assert.equal(root.querySelectorAll('a[href^="javascript:"]').length, 0);
}

const refusedHtml = '<p><img src="invalid:" onerror="document.documentElement.dataset.audit=1"></p>' +
  '<script>document.documentElement.dataset.audit=1</script>' +
  '<a href="javascript:alert(1)" onclick="alert(1)">x</a>';

test("now refused: executable description markup is removed", t => {
  const document = withDom(t);
  const control = new DOMParser().parseFromString(refusedHtml, "text/html");
  assert.equal(control.querySelectorAll("script,[onerror],[onclick]").length, 3);
  const result = new DOMParser().parseFromString(sanitizeDescriptionHtml(refusedHtml), "text/html");
  assertSafe(result);
  assert.equal(result.querySelector("a").hasAttribute("href"), false);
  assert.equal(document.documentElement.dataset.audit, undefined);
  assert.equal(sanitizeDescriptionHtml(""), "");
});

test("now refused: frames require an approved HTTPS host and path and never accept srcdoc", t => {
  withDom(t);
  for (const attributes of [
    'src="https://evil.example/"',
    'src="http://www.youtube.com/embed/video"',
    'src="//www.youtube.com/embed/video"',
    'src="https://www.youtube.com/watch?v=video"',
    'src="https://www.youtube.com.evil.example/embed/video"',
    'src="https://www.youtube.com@evil.example/embed/video"',
    'src="javascript:alert(1)"',
    'src="data:text/html,hello"',
    'src="/embed/video"',
    'src="https://www.youtube.com/embed/video" srcdoc="<p>inline</p>"',
    'SRCDOC="<p>inline</p>"',
    '',
  ]) {
    const result = new DOMParser().parseFromString(sanitizeDescriptionHtml(`<iframe ${attributes}></iframe>`), "text/html");
    assert.equal(result.querySelector("iframe"), null, attributes);
  }
});

test("still allowed: the real Youtube extension's saved embed and every existing embed provider", t => {
  const document = withDom(t);
  const { Youtube } = load("src/components/RTE/Extensions/YoutubeTiptap/index.tsx", {
    "./YoutubeNodeView": { YoutubeNodeView: noop },
    "@tiptap/react": { ReactNodeViewRenderer: noop },
  });
  const spec = Youtube.config.renderHTML.call({
    options: { width: 640, height: 360, HTMLAttributes: {} },
  }, { HTMLAttributes: { src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", width: 640, height: 360, start: 0 } });
  const saved = DOMSerializer.renderSpec(document, spec).dom.outerHTML;
  const result = new DOMParser().parseFromString(sanitizeDescriptionHtml(saved), "text/html");
  assert.equal(result.querySelector("div.video-wrapper iframe").getAttribute("src"),
    "https://www.youtube.com/embed/dQw4w9WgXcQ?controls=0");
  assert.equal(result.querySelector("iframe").getAttribute("width"), "640");
  assert.equal(result.querySelector("iframe").getAttribute("height"), "360");
  assert.ok(result.querySelector("iframe").hasAttribute("allowfullscreen"));
  for (const src of [
    "https://www.loom.com/embed/video", "https://www.youtube-nocookie.com/embed/video",
    "https://player.vimeo.com/video/123", "https://www.figma.com/embed?embed_host=tiptap",
  ]) {
    const html = `<div data-youtube-video=""><iframe src="${src}" title="Embed" allowfullscreen="true" frameborder="0" allow="fullscreen; autoplay"></iframe></div>`;
    const parsed = new DOMParser().parseFromString(sanitizeDescriptionHtml(html), "text/html");
    assert.equal(parsed.querySelector("iframe").getAttribute("src"), src);
    assert.equal(parsed.querySelector("iframe").getAttribute("allow"), "fullscreen; autoplay");
    assert.equal(parsed.querySelector("iframe").getAttribute("frameborder"), "0");
    assert.equal(parsed.querySelector("iframe").getAttribute("title"), "Embed");
    assert.ok(parsed.querySelector("[data-youtube-video]"));
  }
});

test("still allowed: mention spans and links retain all identity attributes", t => {
  withDom(t);
  const attributes = {
    "data-type": "mention", "data-id": "3411", "data-label": "name-3411",
    uniqueindex: "7638", projectid: "15",
  };
  const attrs = Object.entries(attributes).map(([name, value]) => `${name}="${value}"`).join(" ");
  const result = new DOMParser().parseFromString(sanitizeDescriptionHtml(
    `<p><span ${attrs}>QA</span><a ${attrs} href="/detail/project-15/7638">Task</a></p>`,
  ), "text/html");
  for (const mention of result.querySelectorAll("span,a")) {
    for (const [name, value] of Object.entries(attributes)) assert.equal(mention.getAttribute(name), value);
  }
  assert.equal(result.querySelectorAll('[data-type="mention"]').length, 2);
});

test("still allowed: checkboxes, GIF images, tables, highlights, headings and code stay unchanged", t => {
  withDom(t);
  const html = '<h2>Heading</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="true">' +
    '<label><input type="checkbox" checked="" disabled=""><span></span></label><div><p>Done</p></div></li></ul>' +
    '<img src="https://media.giphy.com/image.gif" alt="GIF" width="120" height="80" data-gif-playback-processed="true">' +
    '<table><tbody><tr><th colspan="2">Header</th></tr><tr><td>A</td><td>B</td></tr></tbody></table>' +
    '<p><mark data-color="#ffff00" style="background-color: rgb(255, 255, 0); color: inherit;">Highlight</mark></p>' +
    '<pre><code class="language-js">const value = 1;</code></pre>';
  const before = new DOMParser().parseFromString(html, "text/html").body;
  const after = new DOMParser().parseFromString(sanitizeDescriptionHtml(html), "text/html").body;
  assert.equal(after.innerHTML, before.innerHTML);
});

test("still allowed: HTML block payloads survive unchanged for the existing sandboxed node view", t => {
  const document = withDom(t);
  const { encodeHtmlPayload, decodeHtmlPayload } = jiti(path.join(root, "src/components/RTE/Extensions/HtmlBlock/codec.ts"));
  const { HtmlBlock } = load("src/components/RTE/Extensions/HtmlBlock/index.ts", {
    "./HtmlBlockView": { HtmlBlockView: noop },
    "@tiptap/react": { ReactNodeViewRenderer: noop },
  });
  const payload = '<h1 style="color: red">Canvas</h1><p>Content</p>';
  const spec = HtmlBlock.config.renderHTML({ HTMLAttributes: { "data-html": encodeHtmlPayload(payload) } });
  const saved = DOMSerializer.renderSpec(document, spec).dom.outerHTML;
  const result = new DOMParser().parseFromString(sanitizeDescriptionHtml(saved), "text/html");
  const block = result.querySelector('div[data-html-block="true"]');
  assert.ok(block);
  assert.equal(decodeHtmlPayload(block.getAttribute("data-html")), payload);
});

test("description hooks are removed on success and failure without changing AI sanitization", () => {
  const iframe = '<iframe src="https://evil.example/"></iframe>';
  const fail = () => { throw new Error("sanitization interrupted"); };
  sanitizeDescriptionHtml(iframe);
  assert.ok(purifier.sanitize(iframe, { ADD_TAGS: ["iframe"] }).includes("iframe"));
  purifier.addHook("beforeSanitizeElements", fail);
  try {
    assert.throws(() => sanitizeDescriptionHtml(iframe), /sanitization interrupted/);
  } finally {
    purifier.removeHook("beforeSanitizeElements", fail);
  }
  assert.ok(purifier.sanitize(iframe, { ADD_TAGS: ["iframe"] }).includes("iframe"));
  assert.equal(sanitizeAiHtml('<iframe src="https://www.youtube.com/embed/video"></iframe>'), "");
});

const renderMocks = {
  "next/dynamic": { default: () => () => null },
  "next/navigation": { useRouter: () => ({ push: noop }), useSearchParams: () => new URLSearchParams() },
  "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
  "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
  "@/hooks/General/useGifPlayback": { useGifPlayback: () => ({ control: null }) },
  "../CommentContainer/InnerHTMLComment": { generateAttachmentFromImgEl: noop },
  "../ContextMenu": { HighlightMenu: () => null },
  "../ContextMenu/QuoteButton": { default: () => null },
  "@/lib/configs/taskDetail.config": { taskDetailSpacing: { mobile: { descriptionContainer: "" } } },
};

test("both real description render boundaries sanitize content, including ungated static placeholders", t => {
  withDom(t);
  const Inner = load(`${descriptionDir}InnerHtmlDescription.tsx`, renderMocks).default;
  const { StaticDescriptionBody } = load(`${descriptionDir}StaticDescriptionShell.tsx`, renderMocks);
  for (const element of [
    React.createElement(Inner, { descriptionText: refusedHtml, id: "description", attachmentsFromProps: [] }),
    React.createElement(StaticDescriptionBody, { html: refusedHtml, isMbl: false }),
    React.createElement(StaticDescriptionBody, { html: refusedHtml, isMbl: true }),
  ]) {
    const result = new DOMParser().parseFromString(renderToStaticMarkup(element), "text/html");
    assertSafe(result);
    assert.ok(result.querySelector("a"));
    assert.equal(result.querySelector("a").hasAttribute("href"), false);
  }
});

const helperMocks = {
  "./inboxHelpers": {}, "../sortByParam": { default: noop },
  "react-image-file-resizer": { default: {} }, "@prisma/client": { SortingOrder: {} },
  "./Views/ViewsHelperFunctions": {}, "@/lib/pricingSettingsPaths": {},
  "@/lib/media/browserRenderableImage": {}, "@/lib/media/heicToJpeg": {},
};

test("inert plain-text helpers preserve normal HTML and entity output", t => {
  withDom(t);
  const js = load("src/utils/htmlToString.js").default;
  const tsHelper = load("src/utils/helperFunctions/helperFunctions.ts", helperMocks).convertToPlain;
  for (const html of ["", "Plain", "<html><head></head><body><p>Saved description</p></body></html>", "<p>Hello <strong>world</strong> &amp; friends</p>",
    "<p>First</p><p>Second<br>line</p>", '<p>&lt;b&gt; &amp;quot; &#39;</p>',
    '<p>A<img src="https://example.com/image.png" alt="image">B</p>']) {
    const before = document.createElement("div");
    before.innerHTML = html;
    assert.equal(js(html), before.textContent || "");
    assert.equal(tsHelper(html), before.textContent || "");
  }
});

test("inert notification parsers preserve previews, quote removal and mention highlighting", t => {
  withDom(t);
  const modules = ["@/hooks/useFlag", "@/utils/generateTime", "@/lib/firstScreen/SurfaceContext", "@/lib/firstScreen/display", "../Common/UserAvatar",
    "@/lib/IconsLocal", "../Common/Tooltip", "@/lib/contexts/NotificationContext", "../Common/TaskRowComponents/TaskRowContainer",
    "../Common/TaskRowComponents/TaskTitle", "./inboxSplit/RemindMeInbox", "@/lib/configs/inbox.config",
    "@/lib/nativeAgent/agentMessageEnvelope"];
  const mocks = Object.fromEntries(modules.map(name => [name, {}]));
  const { renderCommentPreview, renderCommentMentionSimple } = load("src/components/notifications/NotificationRow.tsx", {
    ...mocks, "next/dynamic": renderMocks["next/dynamic"],
    "@/utils/undoActions/helperFuncs": renderMocks["@/utils/undoActions/helperFuncs"],
    "@/utils/helperFunctions/helperFunctions": { convertToPlain: load("src/utils/htmlToString.js").default },
  }, "\nexport { renderCommentPreview };\n");
  assert.equal(renderCommentPreview('<p>Hello <strong>world</strong> &amp; friends</p>'), "Hello world & friends");
  const quote = '<p><span data-type="mention">Alice</span> said:</p><blockquote><p>Old text</p></blockquote>';
  assert.equal(renderCommentPreview(`${quote}<p>New text</p>`), "New text");
  assert.equal(renderCommentMentionSimple(`${quote}<p>New text</p>`, 3411), "New text");
  const mention = renderCommentMentionSimple('<p>Hello <span data-type="mention" data-label="name-3411">QA</span> &amp; friends</p>', 3411);
  const result = new DOMParser().parseFromString(renderToStaticMarkup(React.createElement(React.Fragment, null, mention)), "text/html");
  assert.equal(result.body.textContent, "Hello @QA & friends");
  assert.equal(result.querySelector("span.bg-mention-highlight").textContent, "@QA");
});

test("inert AI clipboard parsing preserves normal text in both clipboard modes", async t => {
  withDom(t);
  const { useAiChatPresentation } = load("src/hooks/MultiPages/AIChat/useAiChatPresentation.ts", {
    react: { useEffect: noop, useRef: value => ({ current: value }) },
    "@/hooks/useFlag": { useFlag: () => false, useFlagReady: () => true },
    "@/lib/ai/chipEvents": { signalAiChip: () => {} },
    "@/lib/flags/keys": {}, "@/lib/state": { useRecoilValue: () => false }, "@/store": {},
    "@/utils/aiChat/focusRequestWindow": {}, "react-hot-toast": { default: { success: noop, error: error => { throw new Error(error); } } },
    "@/lib/aiChat/chatOpenSession": {}, "./aiChatShared": { MOBILE_VIEWPORT_MAX_PX: 768 },
  });
  const { copyResponse } = useAiChatPresentation({});
  const html = '<p>Hello <strong>world</strong> &amp; friends</p><p>Next<br>line</p>';
  const previousNavigator = Object.getOwnPropertyDescriptor(global, "navigator");
  const previousClipboardItem = Object.getOwnPropertyDescriptor(global, "ClipboardItem");
  t.after(() => {
    for (const [key, descriptor] of [["navigator", previousNavigator], ["ClipboardItem", previousClipboardItem]]) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  });
  let copied;
  Object.defineProperty(global, "navigator", { configurable: true, value: { clipboard: { writeText: async text => { copied = text; } } } });
  await copyResponse({ content: html, role: "assistant" });
  assert.equal(copied, "Hello world & friendsNextline");
  Object.defineProperty(global, "ClipboardItem", { configurable: true, value: class { constructor(data) { this.data = data; } } });
  Object.defineProperty(global, "navigator", { configurable: true, value: { clipboard: { write: async items => { copied = items; } } } });
  await copyResponse({ content: html, role: "assistant" });
  assert.equal(await copied[0].data["text/plain"].text(), "Hello world & friendsNextline");
  assert.equal(await copied[0].data["text/html"].text(), html);
});

test("both HTML sanitizers share the existing embed policy without changing stored-rich-text sanitization", () => {
  const { sanitizeRichHtml } = jiti(path.join(root, "src/utils/helperFunctions/sanitizeRichHtml.ts"));
  for (const [src, allowed] of [
    ["https://www.youtube.com/embed/video", true], ["https://www.loom.com/embed/video", true],
    ["https://www.youtube-nocookie.com/embed/video", true], ["https://player.vimeo.com/video/123", true],
    ["https://www.figma.com/embed?embed_host=tiptap", true], ["https://evil.example/embed/video", false],
    ["http://www.youtube.com/embed/video", false], ["https://www.youtube.com/watch?v=video", false],
  ]) {
    const html = `<iframe src="${src}"></iframe>`;
    assert.equal(sanitizeRichHtml(html).includes("iframe"), allowed, src);
    assert.equal(sanitizeDescriptionHtml(html).includes("iframe"), allowed, src);
  }
});
