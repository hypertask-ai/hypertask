const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/dictation-block-paste.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const {
  collectDictationTranscriptFromSse,
  normalizeDictationTranscriptForSse,
} = jiti(path.join(root, "src/lib/dictationSse.ts"));

test("SSE parser joins chunked transcript payloads into one string", () => {
  assert.equal(
    collectDictationTranscriptFromSse([
      "data: Hello ",
      "world\n\n",
    ]),
    "Hello world",
  );
});

test("SSE parser handles a single full-transcript event", () => {
  assert.equal(
    collectDictationTranscriptFromSse(["data: One complete block\n\n"]),
    "One complete block",
  );
});

test("normalizeDictationTranscriptForSse collapses provider line breaks", () => {
  assert.equal(normalizeDictationTranscriptForSse("Hello\nWorld"), "Hello World");
  assert.equal(normalizeDictationTranscriptForSse("Hello\n\nWorld"), "Hello World");
  assert.equal(normalizeDictationTranscriptForSse("  spaced\twords  "), "spaced words");
});

test("embedded line breaks in raw SSE payload truncate without server normalization", () => {
  assert.equal(
    collectDictationTranscriptFromSse(["data: Hello\nWorld\n\n"]),
    "Hello",
  );
});

test("normalized transcript survives SSE framing end-to-end", () => {
  const transcript = normalizeDictationTranscriptForSse("Hello\nWorld");
  assert.equal(
    collectDictationTranscriptFromSse([`data: ${transcript}\n\n`]),
    "Hello World",
  );
});
