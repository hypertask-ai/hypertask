const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const jiti = require("jiti")(path.join(__dirname, "fallback-entry.cjs"), {
  interopDefault: true,
});
const { previousModelForFailedStream } = jiti(path.join(__dirname, "../src/app/api/ai/chat/stream/modelFallback.ts"));

test("only new models retry before content and tools, retaining the old slot", () => {
  for (const [next, previous] of [
    ["gpt-6-luna", "gpt-5.6-luna"],
    ["gpt-6-sol", "gpt-5.6-sol"],
    ["claude-opus-5-5", "claude-opus-5"],
  ]) {
    assert.deepEqual(previousModelForFailedStream(next, { statusCode: 404 }, false, false), { model: previous, status: "404" });
    assert.deepEqual(previousModelForFailedStream(next, { cause: { status: 403 } }, false, false), { model: previous, status: "403" });
    assert.equal(previousModelForFailedStream(next, { status: 404 }, true, false), null);
    assert.equal(previousModelForFailedStream(next, { status: 404 }, false, true), null);
    assert.equal(previousModelForFailedStream(next, new Error("timeout"), false, false), null);
  }
  assert.equal(previousModelForFailedStream("gpt-5.6-terra", { status: 404 }, false, false), null);
  assert.equal(previousModelForFailedStream("gpt-5.4-mini", { status: 403 }, false, false), null);
  assert.equal(previousModelForFailedStream("gpt-6-sol", new Error("model not available"), false, false)?.model, "gpt-5.6-sol");
});
