const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const yaml = require("js-yaml");

const root = path.join(__dirname, "..");
const { scripts } = require("../package.json");
const baseline = require("../eslint-local-rules/style-guide-suppressions.json");
const eslint = path.join(path.dirname(require.resolve("eslint/package.json")), "bin/eslint.js");
const styleGuideRules = [
  "tailwindcss/no-custom-classname",
  "hypertask-style/no-raw-tailwind-colors",
  "hypertask-style/no-unapproved-color-literals",
  "hypertask-style/no-forbidden-utilities",
];
const quickCheckRules = ["import/no-duplicates", "no-redeclare", "@typescript-eslint/no-redeclare"];
const rules = [...styleGuideRules, ...quickCheckRules];

function lint(code, filename = "src/components/StyleGuidePipelineProbe.tsx") {
  const fixture = mkdtempSync(path.join(root, ".style-lint-test-"));
  try {
    mkdirSync(path.dirname(path.join(fixture, filename)), { recursive: true });
    writeFileSync(path.join(fixture, filename), code);
    mkdirSync(path.join(fixture, "eslint-local-rules"));
    writeFileSync(path.join(fixture, "eslint-local-rules/style-guide-suppressions.json"), JSON.stringify(baseline));
    const [command, ...args] = scripts.lint.replace(/^bash scripts\/heavy-job\.sh /, "").split(" ");
    assert.equal(command, "eslint");
    const result = spawnSync(process.execPath, [
      eslint, ...args, "--config", path.join(root, "eslint.config.mjs"), "--format", "json",
    ], { cwd: fixture, encoding: "utf8", timeout: 30000 });
    assert.ifError(result.error);
    assert.ok([0, 1].includes(result.status), result.stderr || result.stdout);
    return { status: result.status, result: JSON.parse(result.stdout)[0] };
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

function component(className) {
  return `export default function Probe() { return <div className="${className}" />; }`;
}

test("the required CI lint step uses the baseline-aware npm command without regenerating it", () => {
  const workflow = readFileSync(path.join(root, ".github/workflows/ci-tests.yml"), "utf8");
  const checks = yaml.load(workflow).jobs["ci-checks"];
  assert.equal(checks.if, "needs.ci-prepare.outputs.run_tests == 'true' || needs.ci-prepare.outputs.boundary_needed == 'true'");
  const launcher = checks.steps.find((step) => step.name === "Run independent static checks");
  const { run } = launcher;
  assert.match(run, /^lane_oxlint\(\) \{\n {2}npm run lint:oxlint\n\}$/m);
  assert.match(run, /^ {2}run_lane oxlint$/m);
  const eslintLane = run.match(/^lane_eslint\(\) \{\n([\s\S]*?)\n\}$/m);
  assert.ok(eslintLane, "eslint is a lane of the static gates, not its own step");
  assert.equal(eslintLane[1].trim(),
    "npm run lint -- --cache --cache-strategy content --cache-location .cache/eslint/.eslintcache");
  const refresh = checks.steps.find((step) => step.name === "Refresh production merge for static checks");
  assert.equal(refresh.if, "github.event_name == 'pull_request'");
  assert.match(refresh.run, /git fetch --no-tags origin production\n/);
  assert.match(refresh.run, /merge --no-edit FETCH_HEAD/);
  assert.ok(checks.steps.indexOf(refresh) < checks.steps.indexOf(launcher));
  assert.match(run, /^ {2}run_lane eslint$/m);
  assert.equal(checks.steps.filter((step) => String(step.name ?? "").startsWith("Lint")).length, 0);
  assert.match(scripts.lint, /--suppressions-location eslint-local-rules\/style-guide-suppressions\.json/);
  assert.doesNotMatch(scripts.lint, /--suppress-all|--suppress-rule|--prune-suppressions/);
});

test("PR lint rejects an unchanged file after production advances", () => {
  const fixture = mkdtempSync(path.join(root, ".style-lint-test-"));
  const origin = path.join(fixture, "origin");
  const checkout = path.join(fixture, "checkout");
  const checks = yaml.load(readFileSync(path.join(root, ".github/workflows/ci-tests.yml"), "utf8")).jobs["ci-checks"];
  const refresh = checks.steps.find((step) => step.name === "Refresh production merge for static checks");
  const launcher = checks.steps.find((step) => step.name === "Run independent static checks");
  const lane = launcher.run.match(/^lane_eslint\(\) \{\n[\s\S]*?\n\}/m)[0];
  function git(cwd, ...args) {
    const result = spawnSync("git", args, {
      cwd, encoding: "utf8",
      env: { ...process.env, GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@example.com", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@example.com" },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  try {
    mkdirSync(origin);
    git(origin, "init", "-b", "production");
    mkdirSync(path.join(origin, "src/components"), { recursive: true });
    writeFileSync(path.join(origin, "src/components/Unchanged.tsx"), component("flex"));
    git(origin, "add", ".");
    git(origin, "commit", "-m", "clean production");
    const base = git(origin, "rev-parse", "HEAD");
    git(fixture, "clone", origin, checkout);
    git(checkout, "checkout", "-b", "pull-request");
    writeFileSync(path.join(checkout, "src/components/Changed.tsx"), component("flex"));
    git(checkout, "add", ".");
    git(checkout, "commit", "-m", "clean PR");
    writeFileSync(path.join(checkout, "package.json"), JSON.stringify({ scripts: {
      lint: `${JSON.stringify(process.execPath)} ${JSON.stringify(eslint)} . --config ${JSON.stringify(path.join(root, "eslint.config.mjs"))} --suppressions-location ${JSON.stringify(path.join(root, "eslint-local-rules/style-guide-suppressions.json"))} --pass-on-unpruned-suppressions`,
    } }));
    const runLint = () => spawnSync("bash", ["-euc", `${lane}\nlane_eslint`], {
      cwd: checkout, encoding: "utf8", timeout: 30000,
      env: { ...process.env, BASE_SHA: base },
    });
    const clean = runLint();
    assert.equal(clean.status, 0, clean.stderr || clean.stdout);
    writeFileSync(path.join(origin, "src/components/Unchanged.tsx"), component("bg-red-500"));
    git(origin, "add", ".");
    git(origin, "commit", "-m", "production introduces lint failure");
    const merged = spawnSync("bash", ["-euc", refresh.run], { cwd: checkout, encoding: "utf8" });
    assert.equal(merged.status, 0, merged.stderr || merged.stdout);
    assert.equal(git(checkout, "show", "HEAD:src/components/Unchanged.tsx"), component("bg-red-500"));
    const broken = runLint();
    assert.equal(broken.status, 1, broken.stderr || broken.stdout);
    assert.match(broken.stdout, /Unchanged\.tsx/);
    assert.match(broken.stdout, /hypertask-style\/no-raw-tailwind-colors/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("the baseline contains only known rules, and style-guide paths stay TSX", () => {
  assert.ok(Object.keys(baseline).length > 0);
  for (const [filename, allowances] of Object.entries(baseline)) {
    for (const [rule, { count }] of Object.entries(allowances)) {
      assert.ok(rules.includes(rule), rule);
      assert.ok(Number.isInteger(count) && count > 0);
      if (styleGuideRules.includes(rule)) assert.match(filename, /^src\/.+\.tsx$/);
      else assert.match(filename, /^(?:src|tests|scripts)\/.+/);
    }
  }
});

test("new components using approved theme utilities pass", () => {
  const { status, result } = lint(component("flex bg-modalBackground text-text-light-gray"));
  assert.equal(status, 0);
  assert.equal(result.errorCount, 0);
});

for (const [rule, utility] of [
  [rules[0], "invented-panel"],
  [rules[1], "bg-red-500"],
  [rules[2], "bg-[#123456]"],
  [rules[3], "rounded-lg"],
]) {
  test(`new violations fail npm lint arguments: ${rule}`, () => {
    const { status, result } = lint(component(utility));
    assert.equal(status, 1);
    assert.ok(result.messages.some((message) => message.ruleId === rule && message.severity === 2));
  });
}

test("a baselined file passes its allowance, rejects an added violation, and permits cleanup", () => {
  const rule = "hypertask-style/no-forbidden-utilities";
  const [filename, allowances] = Object.entries(baseline).find(([, entries]) => entries[rule]?.count === 1);
  const allowed = lint(component("shadow-lg"), filename);
  assert.equal(allowed.status, 0);
  assert.ok(allowed.result.suppressedMessages.some((message) => message.ruleId === rule));

  const added = lint(component(Array(allowances[rule].count + 1).fill("shadow-lg").join(" ")), filename);
  assert.equal(added.status, 1);
  assert.ok(added.result.messages.some((message) => message.ruleId === rule));

  assert.equal(lint(component("flex"), filename).status, 0);
});

test("the style baseline does not suppress unrelated lint errors", () => {
  const { status, result } = lint("export default function Probe() { /* note */ return <div />; }");
  assert.equal(status, 1);
  assert.ok(result.messages.some((message) => message.ruleId === "local/no-comments"));
});
