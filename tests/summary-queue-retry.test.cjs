const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const queueFiles = [
  "src/pages/api/queues/FAST/generateSummaryQueue.ts",
  "src/pages/api/queues/AiSummary/NewTaskActivityQueue.ts",
  "src/pages/api/queues/AiSummary/generateSummaryAfterUpsertionQueue.ts",
];

test("every task-summary queue leaves QStash retryable when rescheduling fails", () => {
  for (const relative of queueFiles) {
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    assert.match(source, /SummaryRetryableError/, relative);
    assert.match(source, /status\(503\)/, relative);
  }
});
