const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const {
  trackPrismaQuery,
  N1_QUERY_WARNING_THRESHOLD,
} = jiti(path.join(root, "src/lib/queryCountTracker.ts"));

async function withCapturedWarnings(fn) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.warn = original;
  }
  return warnings;
}

test("stays silent for a normal query count", async () => {
  const warnings = await withCapturedWarnings(() => {
    for (let i = 0; i < N1_QUERY_WARNING_THRESHOLD; i++) {
      trackPrismaQuery("Task");
    }
  });

  assert.deepEqual(warnings, []);
});

test("warns exactly once when a chain crosses the threshold", async () => {
  const warnings = await withCapturedWarnings(() => {
    for (let i = 0; i < N1_QUERY_WARNING_THRESHOLD + 5; i++) {
      trackPrismaQuery("Comment");
    }
  });

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /\[n\+1-detector\]/);
  assert.match(warnings[0], /model=Comment/);
});

test("independent asynchronous call chains count separately", async () => {
  const warnings = await withCapturedWarnings(async () => {
    await Promise.all(
      ["Board", "Task"].map(async (model) => {
        for (let i = 0; i < N1_QUERY_WARNING_THRESHOLD + 1; i++) {
          await Promise.resolve();
          trackPrismaQuery(model);
        }
      }),
    );
  });

  assert.equal(warnings.length, 2);
  assert.equal(warnings.filter((warning) => warning.includes("model=Board")).length, 1);
  assert.equal(warnings.filter((warning) => warning.includes("model=Task")).length, 1);
});
