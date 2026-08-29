const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { normalizeRichHtmlForRender } = jiti(
  path.join(
    root,
    "src/utils/helperFunctions/normalizeRichHtmlForRender.ts",
  ),
);

test("complete editor documents render as body fragments", () => {
  assert.equal(
    normalizeRichHtmlForRender(
      "<html><head><title>ignored</title></head><body><p>Saved text</p></body></html>",
    ),
    "<p>Saved text</p>",
  );
});

test("ordinary rich-text fragments remain unchanged", () => {
  const fragment = '<p>Hello <a href="https://example.com">there</a></p>';

  assert.equal(normalizeRichHtmlForRender(fragment), fragment);
});

test("incomplete document wrappers cannot reach an injected div", () => {
  assert.equal(
    normalizeRichHtmlForRender(
      "<!doctype html><html><head><p>metadata</p></head><body><p>Recovered fragment</p>",
    ),
    "<p>Recovered fragment</p>",
  );
});

test("head content is discarded when a fragment has no body", () => {
  assert.equal(
    normalizeRichHtmlForRender(
      "<html><head><title>metadata</title></head><p>Recovered fragment</p></html>",
    ),
    "<p>Recovered fragment</p>",
  );
});

test("unterminated head content is discarded", () => {
  assert.equal(
    normalizeRichHtmlForRender(
      "<html><head><title>metadata</title><style>p { color: red }</style>",
    ),
    "",
  );
});
