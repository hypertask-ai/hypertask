const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/comment-preview.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { commentPreview } = jiti(
  path.join(
    root,
    "src/utils/controllers/notifications/commentPreview.ts"
  )
);

test("strips HTML tags", () => {
  assert.equal(
    commentPreview("<p>Hello <strong>task</strong></p>"),
    "Hello task"
  );
});

test("decodes common HTML entities", () => {
  assert.equal(
    commentPreview("Tom &amp; Sam &lt;3 &gt;2 &quot;yes&quot; &#39;ok&#39;&nbsp;done"),
    `Tom & Sam <3 >2 "yes" 'ok' done`
  );
});

test("collapses whitespace", () => {
  assert.equal(commentPreview("  Hello\n\t  busy   world  "), "Hello busy world");
});

// Tiptap always emits block elements, so the preview of a real comment is
// unreadable if these boundaries do not become spaces.
test("keeps words apart across block boundaries", () => {
  assert.equal(
    commentPreview("<p>Hello there</p><p>World again</p>"),
    "Hello there World again",
  );
  assert.equal(commentPreview("<ul><li>one</li><li>two</li></ul>"), "one two");
  assert.equal(commentPreview("line one<br>line two"), "line one line two");
});

test("does not split a word at an inline tag", () => {
  assert.equal(commentPreview("<em>i</em>talic"), "italic");
});

test("returns an empty string for null or empty input", () => {
  assert.equal(commentPreview(null), "");
  assert.equal(commentPreview(undefined), "");
  assert.equal(commentPreview(""), "");
});

test("does not truncate short input", () => {
  assert.equal(commentPreview("Short comment", 20), "Short comment");
});

test("truncates on a word boundary and includes the ellipsis in maxChars", () => {
  const preview = commentPreview("one two three four five", 18);

  assert.equal(preview, "one two three…");
  assert.equal(preview.endsWith("…"), true);
  assert.equal(preview.length <= 18, true);
});
