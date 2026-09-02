const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/markdown-to-html.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const {
  formatRichTextInput,
  hasMarkdownStructure,
  markdownToHtml,
  renderMarkdownImage,
} = jiti(path.join(root, "src/utils/helperFunctions/markdownToHtml.ts"));
const { validateCreateTaskBody } = jiti(
  path.join(root, "src/lib/mcp/tasks/validators.ts")
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

test("auto-detects structural markdown without changing HTML or plain prose", () => {
  const examples = [
    ["**bold**", "<strong>bold</strong>"],
    ["*italic*", "<em>italic</em>"],
    ["`inline`", "<code>inline</code>"],
    ["```js\nrun()\n```", "<pre><code"],
    ["# Heading", "<h1>Heading</h1>"],
    ["***", "<hr>"],
    ["line  \nnext", "<br>"],
    ["> quoted", "<blockquote>"],
    ["1. first\n2. second", "<ol>"],
    ["- first\n- second", "<ul>"],
    ["[safe](https://example.com)", '<a href="https://example.com">safe</a>'],
    ["![alt](https://example.com/image.png)", '<a href="https://example.com/image.png"'],
    ["~~removed~~", "<p>removed</p>"],
    ["| A | B |\n|---|---|\n| 1 | 2 |", "<table>"],
  ];

  for (const [input, expectedHtml] of examples) {
    assert.equal(hasMarkdownStructure(input), true, input);
    assert.ok(formatRichTextInput(input).includes(expectedHtml), input);
  }

  const plain = "Cost is 2 * 3 and the range is one - two";
  assert.equal(hasMarkdownStructure(plain), false);
  assert.equal(formatRichTextInput(plain), plain);
  assert.equal(formatRichTextInput("Contact foo@example.com"), "Contact foo@example.com");
  assert.equal(formatRichTextInput("Visit https://example.com"), "Visit https://example.com");
  assert.equal(formatRichTextInput("    indented prose"), "    indented prose");
  assert.equal(formatRichTextInput("\\*literal\\*"), "\\*literal\\*");

  const html = "<p>Keep **literal** markdown</p>";
  assert.equal(hasMarkdownStructure(html), false);
  assert.equal(formatRichTextInput(html), html);
  assert.equal(formatRichTextInput("**literal**", "html"), "**literal**");
  assert.equal(formatRichTextInput("plain text", "markdown"), "<p>plain text</p>");

  const reviewComment = `**AI review:** APPROVE

The changed command usage is safe.

1. Task commands stay on task pages.
2. Kanban commands stay on boards.

\`\`\`text
No material findings.
\`\`\``;
  const renderedReview = formatRichTextInput(reviewComment);
  assert.match(renderedReview, /<strong>AI review:<\/strong>/);
  assert.match(renderedReview, /<ol>[\s\S]*<li>Task commands stay on task pages\.<\/li>/);
  assert.match(renderedReview, /<pre><code class="language-text">/);
  assert.ok(!renderedReview.includes("**"));

  const once = formatRichTextInput("**bold**");
  assert.equal(formatRichTextInput(once), once);

  const unsafeLink = formatRichTextInput("[bad](javascript:alert(1))");
  assert.equal(unsafeLink, "<p><a>bad</a></p>");
});

test("task create normalizes inferred markdown to stored HTML", () => {
  const result = validateCreateTaskBody(
    {
      project_id: 15,
      title: "Agent report",
      description: "**Done**\n\n1. First\n2. Second",
    },
    null
  );

  assert.equal(result.valid, true);
  assert.equal(
    result.data.description,
    "<p><strong>Done</strong></p>\n<ol>\n<li>First</li>\n<li>Second</li>\n</ol>"
  );
});
