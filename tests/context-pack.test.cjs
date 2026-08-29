const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/context-pack.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { extractPrLinks } = jiti(
  path.join(root, "src/lib/mcp/tasks/extractPrLinks.ts")
);

test("extracts multiple GitHub pull request URLs", () => {
  assert.deepEqual(
    extractPrLinks(
      "See https://github.com/acme/app/pull/123 for the implementation.",
      '<a href="https://github.com/acme/api/pull/456">API PR</a>'
    ),
    [
      "https://github.com/acme/app/pull/123",
      "https://github.com/acme/api/pull/456",
    ]
  );
});

test("does not glue two URLs when the anchor text repeats the href (Tiptap HTML)", () => {
  // Real prod shape: <a href="URL">URL</a> with no space between the closing
  // quote/bracket and the repeated URL. A greedy class that only stops at spaces
  // swallows the `">` and returns one mangled URL — this pins that it does not.
  assert.deepEqual(
    extractPrLinks(
      '<a href="https://github.com/valentinyeo/hypertasks/pull/1703">https://github.com/valentinyeo/hypertasks/pull/1703</a>'
    ),
    ["https://github.com/valentinyeo/hypertasks/pull/1703"]
  );
});

test("ignores GitHub URLs that are not pull requests", () => {
  assert.deepEqual(
    extractPrLinks(
      "https://github.com/acme/app/issues/123 https://github.com/acme/app/commit/abc"
    ),
    []
  );
});

test("returns an empty array when no pull request URL is present", () => {
  assert.deepEqual(extractPrLinks("No links here."), []);
});
