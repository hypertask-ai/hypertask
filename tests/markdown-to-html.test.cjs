const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/markdown-to-html.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { markdownToHtml, renderMarkdownImage } = jiti(
  path.join(root, "src/utils/helperFunctions/markdownToHtml.ts")
);

test("converts markdown to sanitized rich HTML", () => {
  // bare text must wrap in a block tag, never come out as a bare text node —
  // this is the regression HTPR-4427 exists to prevent
  assert.equal(markdownToHtml("hello world"), "<p>hello world</p>");

  assert.ok(markdownToHtml("**bold**").includes("<strong>bold</strong>"));
  assert.ok(markdownToHtml("`code`").includes("<code>code</code>"));

  const list = markdownToHtml("- one\n- two");
  assert.ok(list.includes("<ul>"));
  assert.ok(list.includes("<li>one</li>"));

  const link = markdownToHtml("[text](https://example.com)");
  assert.ok(link.includes('<a href="https://example.com">text</a>'));

  // images become links, never <img> — known crash vector in the task-detail UI
  const image = markdownToHtml("![alt](https://example.com/x.png)");
  assert.ok(image.includes('<a href="https://example.com/x.png"'));
  assert.ok(!image.includes("<img"));

  // an image with no usable href must fall back to bare alt text, never a dead anchor
  assert.equal(renderMarkdownImage({ text: "pic2" }), "pic2");
  assert.equal(renderMarkdownImage({}), "");
  // alt text is escaped, so a crafted alt cannot break out into live markup
  assert.equal(
    renderMarkdownImage({ href: "https://example.com/x.png", text: '"><script>' }),
    '<a href="https://example.com/x.png" target="_blank" rel="noopener noreferrer">&quot;&gt;&lt;script&gt;</a>'
  );

  // hostile input 1: markdown-native javascript: URL — the sanitizer strips the
  // href entirely rather than passing it through
  const jsUrlLink = markdownToHtml("[bad](javascript:alert(1))");
  assert.equal(jsUrlLink, "<p><a>bad</a></p>");
  assert.ok(!jsUrlLink.includes("javascript:"));

  // hostile input 2: raw <script>/onerror=/javascript: typed directly as markdown
  // source text. The renderer neutralizes raw HTML rather than emitting it, so all of
  // it must come out fully HTML-escaped — no live tag, no live attribute, nothing
  // executable. This is the property that keeps agent-authored markdown untrusted.
  const rawHtmlAttempt = markdownToHtml(
    '<p>Hello<img src="https://example.com/x.png" onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)" onclick="bad()">bad</a></p>'
  );
  assert.ok(!rawHtmlAttempt.includes("<script>"), "script tag must not survive as a live tag");
  assert.ok(!rawHtmlAttempt.includes('onerror="'), "onerror must not survive as a live attribute");
  assert.ok(!rawHtmlAttempt.includes("<img "), "img tag must not survive as a live tag");
  assert.ok(rawHtmlAttempt.includes("&lt;script&gt;"), "hostile markup is neutralized as escaped text, not dropped silently");
});
