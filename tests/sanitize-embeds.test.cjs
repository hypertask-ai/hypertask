const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/sanitize-embeds.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { sanitizeRichHtml } = jiti(
  path.join(root, "src/utils/helperFunctions/sanitizeRichHtml.ts")
);

test("keeps Loom embeds and only their allowed attributes", () => {
  const html = sanitizeRichHtml(
    '<iframe src="https://www.loom.com/embed/abc123" width="640" height="360" allowfullscreen title="Loom demo" class="embed" data-extra="no"></iframe>'
  );

  assert.equal(
    html,
    '<iframe src="https://www.loom.com/embed/abc123" width="640" height="360" allowfullscreen="" title="Loom demo"></iframe>'
  );
});

test("keeps YouTube privacy-enhanced embeds", () => {
  assert.equal(
    sanitizeRichHtml(
      '<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe>'
    ),
    '<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe>'
  );
});

test("drops unapproved iframe hosts with their content", () => {
  assert.equal(
    sanitizeRichHtml(
      '<p>before</p><iframe src="https://evil.com/embed/video"><p>fallback</p></iframe><p>after</p>'
    ),
    "<p>before</p><p>after</p>"
  );
});

test("drops iframes with javascript sources", () => {
  assert.equal(
    sanitizeRichHtml(
      '<iframe src="javascript:alert(1)"><p>fallback</p></iframe>'
    ),
    ""
  );
});

test("strips active and unapproved attributes from allowed embeds", () => {
  const html = sanitizeRichHtml(
    '<iframe src="https://www.youtube.com/embed/abc" onload="alert(1)" sandbox="allow-scripts" srcdoc="<script>alert(2)</script>" width="640" height="not-a-number" title="Demo"></iframe>'
  );

  assert.equal(
    html,
    '<iframe src="https://www.youtube.com/embed/abc" width="640" title="Demo"></iframe>'
  );
});

test("still drops scripts with their content", () => {
  assert.equal(
    sanitizeRichHtml("<p>safe</p><script>alert(1)</script>"),
    "<p>safe</p>"
  );
});

test("leaves plain paragraphs untouched", () => {
  assert.equal(
    sanitizeRichHtml("<p>Plain paragraph</p>"),
    "<p>Plain paragraph</p>"
  );
});
