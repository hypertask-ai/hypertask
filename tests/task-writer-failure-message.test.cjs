const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/task-writer-jiti-entry-${++jitiEntryId}.cjs`),
    { interopDefault: true, alias: { "@": path.join(root, "src") } }
  );
  return jiti(path.join(root, relativePath));
}

const { describeTaskWriterFailure, describeTaskWriterStreamFailure } = loadTs(
  "src/utils/helperFunctions/describeTaskWriterFailure.ts"
);


test("413 explains the cause and what to do, since no server error exists to report", async () => {
  const msg = await describeTaskWriterFailure(new Response("", { status: 413 }));
  assert.match(msg, /too large/i);
  assert.match(msg, /image/i);
  assert.ok(!/^An error occurred/.test(msg), `fell back to the generic message: ${msg}`);
});

test("a server error message is surfaced rather than replaced", async () => {
  const msg = await describeTaskWriterFailure(
    new Response(JSON.stringify({ error: "Model not allowed on your plan" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    })
  );
  assert.equal(msg, "Model not allowed on your plan");
});

test("a non-JSON error body still yields a message carrying the status", async () => {
  const msg = await describeTaskWriterFailure(
    new Response("<!DOCTYPE html><html>500</html>", { status: 500 })
  );
  assert.match(msg, /500/);
});

test("an empty JSON error field does not produce a blank message", async () => {
  const msg = await describeTaskWriterFailure(
    new Response(JSON.stringify({ error: "   " }), {
      status: 502,
      headers: { "content-type": "application/json" },
    })
  );
  assert.match(msg, /502/);
});

test("only plan-limit refusals prefer message over the legacy error or stream content", async () => {
  for (const code of [undefined, "task-writer-stream-error", "PLAN_LIMIT_REACHED"]) {
    const body = { code, error: "Legacy error", content: "Legacy stream content", message: "Plan refusal" };
    assert.equal(await describeTaskWriterFailure(Response.json(body, { status: 402 })), code === "PLAN_LIMIT_REACHED" ? "Plan refusal" : "Legacy error");
    if (code) assert.equal(describeTaskWriterStreamFailure(`event: error\ndata: ${JSON.stringify(body)}\n\n`), code === "PLAN_LIMIT_REACHED" ? "Plan refusal" : "Legacy stream content");
  }
});
