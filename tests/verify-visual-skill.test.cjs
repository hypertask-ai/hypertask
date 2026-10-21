const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const source = file => readFileSync(path.join(__dirname, "..", file), "utf8");
const skill = source(".claude/skills/verify-visual/SKILL.md");
const workflowPath = ".github/workflows/visual-regression.yml";
const specPath = "e2e/visual/visual.spec.ts";
const configPath = "e2e/visual/playwright.visual.config.ts";
const runnerPath = "scripts/visual-regression-ci.mjs";
const workflow = source(workflowPath);
const spec = source(specPath);
const config = source(configPath);

function checkMap(text, specSource = spec) {
  const documented = [...text.matchAll(/^\| `([^`]+)` \|/gm)].map(match => match[1]);
  const declared = specSource.match(/const screens = \[([^\]]+)\]/);
  assert.ok(declared, "visual spec must declare its screen inventory");
  const screens = [...declared[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.ok(screens.length > 0, "screen inventory cannot be empty");
  assert.deepEqual(documented, screens, "skill map must match every captured screen exactly once");
}

test("visual skill is registered and every named repository path exists", () => {
  assert.match(skill, /^---\nname: verify-visual\ndescription: .+\n---/);
  assert.match(source(".claude/skills/INDEX.md"), /^\| verify-visual \| .+ \| \.claude\/skills\/verify-visual\/SKILL\.md \|$/m);
  for (const file of [workflowPath, specPath, configPath, runnerPath, "scripts/seed-browser-smoke.mjs", "tests/verify-visual-skill.test.cjs"]) {
    assert.ok(skill.includes(file), `skill must name ${file}`);
    assert.ok(source(file).length > 0, `${file} must exist`);
  }
  assert.doesNotMatch(skill, /\u2014/);
});

test("skill map and dimensions describe the actual capture spec and config", () => {
  checkMap(skill);
  assert.ok(config.includes(`testMatch: '${path.basename(specPath)}'`));
  for (const match of config.matchAll(/width: (\d+), height: (\d+)/g)) {
    assert.ok(skill.includes(`${match[1]}x${match[2]}`), "skill must document each viewport");
  }
  assert.match(spec, /toHaveAttribute\('data-theme', 'porcelain'\)/);
  assert.ok(skill.includes("Porcelain"));
  assert.ok(source(runnerPath).includes(configPath));
  assert.ok(workflow.includes(`node head/${runnerPath}`));
});

test("skill names the real workflow, failure artifact and review contract", () => {
  const workflowName = workflow.match(/^name: (.+)$/m)[1];
  const artifact = workflow.match(/name: (visual-regression-diffs)/)[1];
  const retention = workflow.match(/retention-days: (\d+)/)[1];
  assert.ok(skill.includes(`**${workflowName}**`));
  assert.ok(skill.includes(`--name ${artifact}`));
  assert.ok(skill.includes(`${retention}-day retention`));
  for (const text of ["Heavy runs only in GitHub Actions", "gh run view", "gh run download", "expected (base)", "actual (head)", "diff PNGs", "Visual change approved: <ticket URL>", "GitHub run link", "blocked, not verified"]) {
    assert.ok(skill.includes(text), `missing operating contract: ${text}`);
  }
  assert.ok(source("docs/ci.md").includes("Visual change approved: <ticket URL>"));
});

test("map drift check rejects removed documentation and a newly captured screen", () => {
  assert.throws(() => checkMap(skill.replace(/^\| `board`.*\n/m, "")), /skill map must match/);
  assert.throws(() => checkMap(skill, spec.replace("'inbox']", "'inbox', 'new-screen']")), /skill map must match/);
});
