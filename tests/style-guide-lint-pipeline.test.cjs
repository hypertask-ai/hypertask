const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const { scripts } = require("../package.json");
const baseline = require("../eslint-local-rules/style-guide-suppressions.json");
const eslint = path.join(path.dirname(require.resolve("eslint/package.json")), "bin/eslint.js");
const rules = [
  "tailwindcss/no-custom-classname",
  "hypertask-style/no-raw-tailwind-colors",
  "hypertask-style/no-unapproved-color-literals",
  "hypertask-style/no-forbidden-utilities",
];

function lint(code, filename = "src/components/StyleGuidePipelineProbe.tsx") {
  // ESLint does not apply bulk suppressions to stdin. Use an isolated fixture
  // with the production config and baseline instead of changing source files.
  const fixture = mkdtempSync(path.join(root, ".style-lint-test-"));
  try {
    mkdirSync(path.dirname(path.join(fixture, filename)), { recursive: true });
    writeFileSync(path.join(fixture, filename), code);
    mkdirSync(path.join(fixture, "eslint-local-rules"));
    writeFileSync(path.join(fixture, "eslint-local-rules/style-guide-suppressions.json"), JSON.stringify(baseline));
    const [command, ...args] = scripts.lint.split(" ");
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
  assert.match(workflow, /name: Lint\s+if:[^\n]+\s+run: npm run lint -- --cache/);
  assert.match(scripts.lint, /--suppressions-location eslint-local-rules\/style-guide-suppressions\.json/);
  assert.doesNotMatch(scripts.lint, /--suppress-all|--suppress-rule|--prune-suppressions/);
});

test("the baseline contains only existing TSX files and the four style-guide rules", () => {
  assert.ok(Object.keys(baseline).length > 0);
  for (const [filename, allowances] of Object.entries(baseline)) {
    assert.match(filename, /^src\/.+\.tsx$/);
    readFileSync(path.join(root, filename));
    for (const [rule, { count }] of Object.entries(allowances)) {
      assert.ok(rules.includes(rule), rule);
      assert.ok(Number.isInteger(count) && count > 0);
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
  const { status, result } = lint("export default function Probe() { return <div>don't</div>; }");
  assert.equal(status, 1);
  assert.ok(result.messages.some((message) => message.ruleId === "react/no-unescaped-entities"));
});
