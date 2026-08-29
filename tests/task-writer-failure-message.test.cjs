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

const { describeTaskWriterFailure } = loadTs(
  "src/utils/helperFunctions/describeTaskWriterFailure.ts"
);

// WHY: the AI Task Writer used to render one sentence for every possible failure, so a
// request the platform rejected outright looked identical to the model being down. Valentin
// hit this on a task with pasted screenshots and had no way to tell what was wrong or what
// to do about it. Each branch here has to say something the user can act on. Ref HTPR-4735.

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

// A crashed route returns Next's HTML error page, which is not JSON. Parsing it must not
// throw and lose the failure entirely.
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
