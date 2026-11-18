const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const covered = [
  "src/lib/mcp/webhooks/outboxDelivery.ts",
  "src/lib/mcp/webhooks/queue.ts",
  "src/lib/mcp/webhooks/events.ts",
  "verification/formal/checks.json",
  "verification/formal/webhook-retry/BoardWebhook.tla",
  "verification/formal/webhook-retry/BoardWebhook.cfg",
  ".claude/skills/formal-verification/SKILL.md",
];

test("the webhook retry model covers the files its record names", () => {
  for (const file of covered) {
    assert.ok(existsSync(path.join(root, file)), `${file} is named in the record and missing`);
  }
});

test("the webhook retry model raises the recorded finding and nothing else", () => {
  const checked = spawnSync(
    process.execPath,
    ["scripts/formal-verification/run.mjs", "webhook-retry"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(checked.status, 0, `${checked.stdout}\n${checked.stderr}`);
  assert.match(
    checked.stdout,
    /formal-verification: ok webhook-retry matches its record .*AttemptsBound holds, PostsWithinCap violated \(recorded finding\), SuccessNotReportedFailed violated \(recorded finding\)/,
  );
});
