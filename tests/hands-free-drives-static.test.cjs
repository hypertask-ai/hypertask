const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const drives = ["ai-chat-drive.mjs", "ctrl-j-drive.mjs"];

test("hands-free drives parse and refuse any non-loopback base", () => {
  for (const drive of drives) {
    const file = path.join(".claude/skills/verify-qa/scripts", drive);
    assert.equal(spawnSync(process.execPath, ["--check", file], { cwd: root, encoding: "utf8" }).status, 0, `${drive} does not parse`);
    const refused = spawnSync(process.execPath, [
      file, path.join(tmpdir(), `drive-check-${process.pid}`), "--base", "https://app.hypertask.ai",
      "--state", path.join(tmpdir(), "never-read-state.json"),
    ], { cwd: root, encoding: "utf8", timeout: 30_000 });
    assert.equal(refused.status, 2, `${drive} did not refuse a remote base`);
    assert.match(refused.stderr, /refuses a non-loopback base/);
  }
});

test("each drive is linked from its feature page and the hosted journey", async () => {
  assert.match(read(".claude/skills/verify-qa/reference/feature-map/ai-chat.md"), /scripts\/ai-chat-drive\.mjs[\s\S]*ai-chat drive ok[\s\S]*negative control ok/);
  assert.match(read(".claude/skills/verify-qa/reference/feature-map/command-palette.md"), /scripts\/ctrl-j-drive\.mjs[\s\S]*ctrl-j drive ok[\s\S]*negative control ok/);
  const { HANDS_FREE_DRIVES } = await import(path.join(root, "scripts/verify-qa-run.mjs"));
  assert.deepEqual([...new Set(HANDS_FREE_DRIVES.map((drive) => drive.script))].sort(), [...drives].sort());
  assert.equal(HANDS_FREE_DRIVES.filter((drive) => drive.expect === "negative control ok").length, 2);
  assert.match(read(".github/workflows/visual-regression.yml"), /options: \[visual, inbox-cycle, inbox-cycle-broken, hands-free-drives\]/);
  assert.match(read("docs/ci-policy.yml"), /journeys: \[inbox-cycle, inbox-cycle-broken, hands-free-drives\]/);
});
