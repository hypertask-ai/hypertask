const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.resolve(__dirname, "../src/lib/timeTracking.ts"),
  "utf8",
);

function functionSource(name, nextName) {
  const start = source.indexOf(`export async function ${name}`);
  const end = source.indexOf(`export async function ${nextName}`, start);
  assert.notEqual(start, -1, `${name} must exist`);
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return source.slice(start, end);
}

test("completed time mutations notify the task and board realtime channels", () => {
  for (const body of [
    functionSource("logMinutes", "createManualEntry"),
    functionSource("createManualEntry", "listRunning"),
    functionSource("updateEntry", "deleteEntry"),
    functionSource("deleteEntry", "taskSummary"),
  ]) {
    assert.match(body, /notifyTimeChange\(/);
  }
});
