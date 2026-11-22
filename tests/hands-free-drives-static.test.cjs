const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const drives = [
  "ai-chat-drive.mjs",
  "ctrl-j-drive.mjs",
  "board-drive-live.mjs",
  "task-drive-live.mjs",
  "comments-drive-live.mjs",
  "flags-drive-live.mjs",
];

test("hands-free drives parse and refuse any non-loopback base", () => {
  for (const drive of drives) {
    const file = path.join(".claude/skills/verify-qa/scripts", drive);
    assert.equal(spawnSync(process.execPath, ["--check", file], { cwd: root, encoding: "utf8" }).status, 0, `${drive} does not parse`);
    const refused = spawnSync(process.execPath, [
      file, path.join(tmpdir(), `drive-check-${process.pid}`), "--base", "https://app.hypertask.ai",
      "--state", path.join(tmpdir(), "never-read-state.json"),
    ], { cwd: root, encoding: "utf8", timeout: 30_000, env: { ...process.env, FEATURE_MAP_LIVE: "" } });
    assert.equal(refused.status, 2, `${drive} did not refuse a remote base`);
    assert.match(refused.stderr, /refuses a non-loopback base/);
  }
});

test("the live opt-in unlocks the production origin and nothing else", async () => {
  const { driveBaseAllowed, LIVE_BASE } = await import(path.join(root, ".claude/skills/verify-qa/scripts/drive-grade.mjs"));
  const guard = (base, live) => { process.env.FEATURE_MAP_LIVE = live; const allowed = driveBaseAllowed(base); delete process.env.FEATURE_MAP_LIVE; return allowed; };
  assert.equal(guard("http://127.0.0.1:3100", ""), true);
  assert.equal(guard(LIVE_BASE, ""), false, "production without the opt-in");
  assert.equal(guard(LIVE_BASE, "1"), true);
  for (const base of ["https://app.hypertask.ai/", "http://app.hypertask.ai", "https://preview.hypertask.ai", "https://example.com", "https://app.hypertask.ai.evil.example"]) assert.equal(guard(base, "1"), false, `the opt-in allowed ${base}`);
  const outside = spawnSync(process.execPath, [path.join(".claude/skills/verify-qa/scripts", "board-drive-live.mjs"), path.join(tmpdir(), "drive-check-outside"), "--base", "https://example.com", "--state", path.join(tmpdir(), "never-read-state.json")],
    { cwd: root, encoding: "utf8", timeout: 30_000, env: { ...process.env, FEATURE_MAP_LIVE: "1" } });
  assert.equal(outside.status, 2, "the opt-in drove a host it does not name");
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
