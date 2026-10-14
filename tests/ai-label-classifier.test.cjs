const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/ai-label-classifier-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { parseMatchingLabelIds } = jiti(
  path.join(root, "src/lib/ai/labelClassifierOutput.ts")
);

const definitions = [
  { labelId: "opportunity", prompt: "An opportunity" },
  { labelId: "minimal", prompt: "Minimalist" },
];

test("smart-label output accepts only known string ids", () => {
  assert.deepEqual(
    parseMatchingLabelIds('["minimal","opportunity","minimal"]', definitions),
    ["minimal", "opportunity"]
  );
  assert.deepEqual(parseMatchingLabelIds('["unknown"]', definitions), []);
  assert.deepEqual(
    parseMatchingLabelIds('["minimal", 1]', definitions),
    ["minimal"]
  );
});

test("smart-label output strips markdown fences and accepts valid empty arrays", () => {
  assert.deepEqual(
    parseMatchingLabelIds("```json\n[]\n```", definitions),
    []
  );
});

test("smart-label output tolerates prose around the array (HTPR-7211)", () => {
  assert.deepEqual(
    parseMatchingLabelIds('Matching ids: ["minimal"]', definitions),
    ["minimal"]
  );
  assert.deepEqual(
    parseMatchingLabelIds('Here you go:\n```json\n["opportunity"]\n```\nDone.', definitions),
    ["opportunity"]
  );
  assert.deepEqual(parseMatchingLabelIds("None match.\n[]", definitions), []);
  assert.deepEqual(parseMatchingLabelIds('["minimal"]\nDone.', definitions), ["minimal"]);
  assert.deepEqual(parseMatchingLabelIds('["a]b", "minimal"] ok', definitions), ["minimal"]);
});

test("smart-label output never reads an array nested in an object as a verdict", () => {
  assert.equal(parseMatchingLabelIds('Result: {"error":[]}', definitions), null);
  assert.equal(parseMatchingLabelIds('{"ids":["minimal"]} done', definitions), null);
});

test("smart-label output returns null (not empty) on unparsable model output", () => {
  assert.equal(parseMatchingLabelIds('{"ids":[]}', definitions), null);
  assert.equal(parseMatchingLabelIds("not json", definitions), null);
});
