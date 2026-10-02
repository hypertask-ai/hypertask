const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") } });
const source = fs.readFileSync(path.join(root,
  "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/InnerHTMLComment.tsx"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const noop = () => {};
const mocks = {
  "next/dynamic": { __esModule: true, default: () => () => null },
  "next/navigation": { useRouter: () => ({ push: noop }), useSearchParams: () => new URLSearchParams() },
  "@/styles/tiptap.module.scss": { __esModule: true, default: {} },
  "@/lib/state": { useRecoilState: () => [{ id: 3411 }, noop] },
  "@/store": { currentUserAtom: {} },
  "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
  "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
  "@/hooks/General/useGifPlayback": { useGifPlayback: () => ({ control: null }) },
  "../ContextMenu": { HighlightMenu: () => null },
  "../ContextMenu/QuoteButton": { __esModule: true, default: () => null },
  "./CommentTldr": { __esModule: true, default: () => null },
};
const componentModule = { exports: {} };
new Function("require", "module", "exports", compiled)(
  (specifier) => mocks[specifier] ?? (specifier.startsWith("@/")
    ? jiti(path.join(root, "src", specifier.slice(2))) : require(specifier)),
  componentModule, componentModule.exports,
);
const InnerHTMLComment = componentModule.exports.default;
function renderComment(commentText) {
  return new JSDOM(renderToStaticMarkup(React.createElement(InnerHTMLComment, {
    commentText, id: "comment-under-test", allowQuote: false,
  }))).window.document.getElementById("comment-under-test");
}

test("stored comment HTML strips executable nodes and event handlers at the real render boundary", () => {
  const payload = '<p>safe</p><img src="data:," onerror="window.__commentXss=1">' +
    '<script>window.__commentXss=1</script><a href="javascript:window.__commentXss=1">unsafe</a>';
  const control = new JSDOM(payload).window.document;
  assert.equal(control.querySelectorAll('script,[onerror],a[href^="javascript:"]').length, 3);
  const comment = renderComment(payload);
  assert.equal(comment.querySelectorAll('script,[onerror],a[href^="javascript:"]').length, 0);
  assert.equal(comment.querySelector("p").textContent, "safe");
});

test("comment rendering preserves mentions, links, images, attachments, code and formatting", () => {
  const comment = renderComment(
    '<p><span class="mention" data-type="mention" data-id="3411" data-label="name-3411" ' +
    'projectid="15" uniqueindex="6829">QA person</span> <strong>bold</strong><em>italic</em><u>underline</u></p>' +
    '<a href="https://hypertask.app" target="_blank">safe link</a>' +
    '<a href="https://hypertask.app/file.pdf" download="file.pdf">attachment</a>' +
    '<img src="https://hypertask.app/image.png" alt="image" width="120">' +
    '<pre><code class="language-js">const value = 1;</code></pre><blockquote>quote</blockquote>' +
    '<ul><li>list item</li></ul><p>https://hypertask.app/wiki</p>',
  );
  const mention = comment.querySelector(".mention");
  for (const [name, value] of Object.entries({
    "data-type": "mention", "data-id": "3411", "data-label": "name-3411", projectid: "15", uniqueindex: "6829",
  })) assert.equal(mention.getAttribute(name), value);
  assert.equal(comment.querySelector('a[href="https://hypertask.app"]').textContent, "safe link");
  assert.equal(comment.querySelector('a[download="file.pdf"]').textContent, "attachment");
  assert.equal(comment.querySelector('a[href="https://hypertask.app/wiki"]').textContent, "https://hypertask.app/wiki");
  assert.equal(comment.querySelector("img").getAttribute("src"), "https://hypertask.app/image.png");
  assert.equal(comment.querySelector("pre code.language-js").textContent, "const value = 1;");
  for (const tag of ["strong", "em", "u", "blockquote", "ul li"]) assert.ok(comment.querySelector(tag));
});
