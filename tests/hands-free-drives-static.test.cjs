const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const driveDir = ".claude/skills/verify-qa/scripts";
const drives = [
  "ai-chat-drive.mjs",
  "ctrl-j-drive.mjs",
  "board-drive-live.mjs",
  "task-drive-live.mjs",
  "comments-drive-live.mjs",
  "flags-drive-live.mjs",
];
const remoteBases = ["https://app.hypertask.ai", "https://example.com", "https://app.hypertask.ai.evil.example"];
const driveEnv = (live) => {
  const env = { ...process.env };
  if (live) env.FEATURE_MAP_LIVE = "1";
  else delete env.FEATURE_MAP_LIVE;
  return env;
};
const runDrive = (drive, base, live) => spawnSync(process.execPath, [
  path.join(driveDir, drive), path.join(tmpdir(), `drive-check-${process.pid}`), "--base", base,
  "--state", path.join(tmpdir(), "never-read-state.json"),
], { cwd: root, encoding: "utf8", timeout: 30_000, env: driveEnv(live) });

test("hands-free drives parse and refuse any non-loopback base", () => {
  for (const drive of drives) {
    const file = path.join(driveDir, drive);
    assert.equal(spawnSync(process.execPath, ["--check", file], { cwd: root, encoding: "utf8" }).status, 0, `${drive} does not parse`);
    for (const base of remoteBases) {
      const refused = runDrive(drive, base, false);
      assert.equal(refused.status, 2, `${drive} did not refuse ${base}`);
      assert.match(refused.stderr, /refuses a non-loopback base/, `${drive} refused ${base} with the wrong reason`);
    }
  }
});

test("the live opt-in unlocks the production origin and nothing else", async () => {
  const previous = process.env.FEATURE_MAP_LIVE;
  const { driveBaseAllowed, LIVE_BASE } = await import(path.join(root, driveDir, "drive-grade.mjs"));
  delete process.env.FEATURE_MAP_LIVE;
  assert.equal(driveBaseAllowed("http://127.0.0.1:3100"), true);
  assert.equal(driveBaseAllowed("http://localhost:3100"), true);
  for (const base of remoteBases) assert.equal(driveBaseAllowed(base), false, `no opt-in allowed ${base}`);
  process.env.FEATURE_MAP_LIVE = "1";
  assert.equal(driveBaseAllowed(LIVE_BASE), true);
  for (const base of ["https://app.hypertask.ai/", "http://app.hypertask.ai", "https://preview.hypertask.ai",
    "https://app.hypertask.ai.evil.example", "https://example.com"]) {
    assert.equal(driveBaseAllowed(base), false, `the opt-in allowed ${base}`);
  }
  if (previous === undefined) delete process.env.FEATURE_MAP_LIVE;
  else process.env.FEATURE_MAP_LIVE = previous;
  for (const drive of drives) {
    const refused = runDrive(drive, "https://example.com", true);
    assert.equal(refused.status, 2, `${drive} drove a host the opt-in does not name`);
    assert.match(refused.stderr, /refuses a non-loopback base/);
  }
});

test("each drive is linked from its feature page and the hosted journey", async () => {
  assert.match(read(".claude/skills/verify-qa/reference/feature-map/ai-chat.md"), /scripts\/ai-chat-drive\.mjs[\s\S]*ai-chat drive ok[\s\S]*negative control ok/);
  assert.match(read(".claude/skills/verify-qa/reference/feature-map/command-palette.md"), /scripts\/ctrl-j-drive\.mjs[\s\S]*ctrl-j drive ok[\s\S]*negative control ok/);
  assert.match(read(".claude/skills/verify-qa/reference/feature-map/boards-and-views.md"), /scripts\/board-drive-live\.mjs[\s\S]*board ok[\s\S]*negative control ok/);
  assert.match(read(".claude/skills/verify-qa/reference/feature-map/task-detail-and-description.md"), /scripts\/task-drive-live\.mjs[\s\S]*task ok[\s\S]*negative control ok/);
  assert.match(read(".claude/skills/verify-qa/reference/feature-map/comments-and-mentions.md"), /scripts\/comments-drive-live\.mjs[\s\S]*comments ok[\s\S]*negative control ok/);
  assert.match(read(".claude/skills/verify-qa/reference/feature-map/feature-flags-api.md"), /scripts\/flags-drive-live\.mjs[\s\S]*flags ok[\s\S]*negative control ok/);
  const { HANDS_FREE_DRIVES } = await import(path.join(root, "scripts/verify-qa-run.mjs"));
  assert.deepEqual([...new Set(HANDS_FREE_DRIVES.map((drive) => drive.script))].sort(), [...drives].sort());
  assert.equal(HANDS_FREE_DRIVES.filter((drive) => drive.expect === "negative control ok").length, drives.length);
  assert.match(read(".github/workflows/visual-regression.yml"), /options: \[visual, inbox-cycle, inbox-cycle-broken, hands-free-drives\]/);
  assert.match(read("docs/ci-policy.yml"), /journeys: \[inbox-cycle, inbox-cycle-broken, hands-free-drives\]/);
});
