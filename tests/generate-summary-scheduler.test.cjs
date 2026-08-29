const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("summary scheduling preserves omitted versus human agent attribution", async () => {
  const jobs = [];
  const qstashPath = path.join(root, "src/lib/qstash.ts");
  require.cache[qstashPath] = {
    id: qstashPath,
    filename: qstashPath,
    loaded: true,
    exports: {
      scheduleJobById: async (job) => {
        jobs.push(job);
        return { messageId: `summary-${jobs.length}` };
      },
    },
  };

  const jiti = require("jiti")(path.join(root, "tests/generate-summary-scheduler-entry.cjs"), {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  });
  const loaded = jiti(
    path.join(root, "src/pages/api/queues/FAST/generateSummary.ts"),
  );
  const scheduleTaskSummaryGeneration = loaded.default ?? loaded;

  await scheduleTaskSummaryGeneration({ taskId: 42 });
  await scheduleTaskSummaryGeneration({ taskId: 43, agentId: null });

  assert.deepEqual(jobs[0].body, { taskId: 42 });
  assert.deepEqual(jobs[1].body, { taskId: 43, agentId: null });
});
