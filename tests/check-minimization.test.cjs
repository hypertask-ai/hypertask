const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const workflows = path.join(__dirname, "..", ".github", "workflows");
const read = (name) => yaml.load(fs.readFileSync(path.join(workflows, `${name}.yml`), "utf8"));
const exists = (name) => fs.existsSync(path.join(workflows, `${name}.yml`));

test("a bug fix's proof runs inside the tests it proves, not in its own workflow", () => {
  const ci = read("ci-tests");
  const job = ci.jobs["repro-first"];
  assert.ok(job, "repro-first is a job of ci-tests");
  assert.equal(exists("repro-first"), false);
  assert.match(job.if, /contains\(github\.event\.pull_request\.title, '\[BUGFIX\]'\)/);
  assert.equal(job["continue-on-error"], undefined);
  const runs = job.steps.map((step) => step.run).filter(Boolean).join("\n");
  assert.match(runs, /node \.github\/scripts\/repro-first\.mjs --scope/);
  assert.match(runs, /node \.github\/scripts\/repro-first\.mjs$/m);
  assert.ok(
    !ci.jobs["ci-tests"].needs.includes("repro-first"),
    "a missing proof is loud on its own job and does not redden the build summary",
  );
});

test("the UX sign-off gate is a sweep, so a pull request event pays no job for it", () => {
  const gate = read("ux-signoff-gate");
  assert.deepEqual(Object.keys(gate.on), ["workflow_dispatch"]);
  const chain = read("ux-signoff-chain");
  assert.match(JSON.stringify(chain), /ux-signoff-gate\.yml/);
});

test("the feature map gate covers new features only, never coverage growth", () => {
  const ci = read("ci-tests");
  const launcher = ci.jobs["ci-checks"].steps.find((step) => step.name === "Run independent static checks");
  assert.match(launcher.run, /^ *lane_feature_map_change\(\) \{$/m);
  assert.match(launcher.run, /^ *run_lane feature-map-change$/m);
  assert.doesNotMatch(launcher.run, /feature.map.coverage/);
  assert.equal(fs.existsSync(path.join(__dirname, "..", ".github", "scripts", "feature-map-coverage.cjs")), false);
  assert.equal(exists("feature-map-coverage"), false);
});

test("the weekly citation check keeps its Monday run and folds its pull request path into skills-evals", () => {
  const weekly = read("feature-map-weekly");
  assert.deepEqual(Object.keys(weekly.on).sort(), ["schedule", "workflow_dispatch"]);
  assert.equal(weekly.on.schedule[0].cron, "37 3 * * 1");
  const evals = read("skills-evals");
  const paths = evals.on.pull_request.paths.join("\n");
  for (const expected of [".claude/skills/**", ".github/scripts/feature-map-live-weekly-file.mjs", "tests/feature-map-live-weekly-file.test.cjs"]) {
    assert.ok(paths.includes(expected), expected);
  }
  const runs = evals.jobs["run-evals"].steps.map((step) => step.run).filter(Boolean).join("\n");
  assert.match(runs, /feature-map-check\.mjs/);
  assert.match(runs, /feature-map-check\.test\.mjs/);
});
