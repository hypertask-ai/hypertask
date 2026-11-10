const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const drives = ["ai-chat-drive.mjs", "ctrl-j-drive.mjs"];

test("hands-free drives parse and refuse any non-loopback base", () => {
  for (const drive of drives) {
    const file = path.join(".claude/skills/verify-qa/scripts", drive);
    const syntax = spawnSync(process.execPath, ["--check", file], { cwd: root, encoding: "utf8" });
    assert.equal(syntax.status, 0, `${drive} does not parse: ${syntax.stderr}`);

    const refused = spawnSync(process.execPath, [
      file, path.join(require("node:os").tmpdir(), `drive-check-${process.pid}`),
      "--base", "https://app.hypertask.ai",
      "--state", path.join(require("node:os").tmpdir(), "never-read-state.json"),
    ], { cwd: root, encoding: "utf8", timeout: 30_000 });
    assert.equal(refused.status, 2, `${drive} did not refuse a remote base`);
    assert.match(refused.stderr, /refuses a non-loopback base/);
    assert.match(read(file), /never production/);
  }
});

test("hands-free drives are the command each feature page names", () => {
  const aiChat = read(".claude/skills/verify-qa/reference/feature-map/ai-chat.md");
  const palette = read(".claude/skills/verify-qa/reference/feature-map/command-palette.md");
  assert.match(aiChat, /scripts\/ai-chat-drive\.mjs/);
  assert.match(aiChat, /ai-chat drive ok/);
  assert.match(palette, /scripts\/ctrl-j-drive\.mjs/);
  assert.match(palette, /ctrl-j drive ok/);
  for (const page of [aiChat, palette]) assert.match(page, /negative control ok/);
  assert.match(read(".claude/skills/verify-qa/reference/feature-map/rows/ai-chat.md"), /ai-chat-drive\.mjs/);
  assert.match(read(".claude/skills/verify-qa/reference/feature-map/rows/command-palette.md"), /ctrl-j-drive\.mjs/);
});

test("the hosted journey runs both drives and both broken-shortcut controls", async () => {
  const runner = await import(path.join(root, "scripts/verify-qa-run.mjs"));
  const scripts = runner.HANDS_FREE_DRIVES.map((drive) => drive.script);
  assert.deepEqual([...new Set(scripts)].sort(), [...drives].sort());
  const controls = runner.HANDS_FREE_DRIVES.filter((drive) => drive.args.includes("--break"));
  assert.equal(controls.length, 2);
  for (const control of controls) assert.equal(control.expect, "negative control ok");
  assert.deepEqual(
    runner.HANDS_FREE_DRIVES.filter((drive) => !drive.args.includes("--break")).map((drive) => drive.expect),
    ["ai-chat drive ok", "ctrl-j drive ok"],
  );
  assert.match(read(".github/workflows/visual-regression.yml"), /options: \[visual, inbox-cycle, inbox-cycle-broken, hands-free-drives\]/);
  assert.match(read("scripts/verify-qa"), /inbox-cycle\|inbox-cycle-broken\|hands-free-drives/);
  assert.match(read("docs/ci-policy.yml"), /journeys: \[inbox-cycle, inbox-cycle-broken, hands-free-drives\]/);
});
