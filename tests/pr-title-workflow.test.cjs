const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const yaml = require("js-yaml");

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const TAGS = [
  "BUGFIX",
  "FEATURE",
  "IMPROVE",
  "CLI/MCP/AI",
  "SPEED",
  "FEEDBACK",
  "DASH",
  "QA",
  "BOARD",
  "COST",
  "PLAN",
  "INFRA",
];

async function runTitleCheck(title) {
  const workflow = yaml.load(
    await readFile(".github/workflows/pr-size.yml", "utf8"),
  );
  const script = workflow.jobs["pr-title"].steps[0].with.script;
  const failures = [];

  await new AsyncFunction("github", "context", "core", script)(
    {
      rest: {
        pulls: {
          get: async () => ({ data: { title, user: { login: "owner" } } }),
        },
      },
    },
    {
      payload: { pull_request: { number: 43 } },
      repo: { owner: "hypertask-ai", repo: "hypertask" },
    },
    {
      info() {},
      setFailed(message) {
        failures.push(message);
      },
    },
  );

  return failures;
}

test("PR title accepts HTPR and HYFA tickets with every current work tag", async () => {
  for (const prefix of ["HTPR", "HYFA"]) {
    for (const tag of TAGS) {
      assert.deepEqual(
        await runTitleCheck(`${prefix}-43 [${tag}] Keep the current title rule`),
        [],
        `${prefix} with ${tag} should pass`,
      );
    }
  }
});

test("PR title rejects foreign and lookalike ticket prefixes", async () => {
  for (const title of [
    "FACTORY-43 [INFRA] Foreign prefix",
    "XHYFA-43 [INFRA] Leading lookalike",
    "hyfa-43 [INFRA] Lowercase lookalike",
    "HYFA-43abc [INFRA] Trailing ticket text",
  ]) {
    const failures = await runTitleCheck(title);
    assert.equal(failures.length, 1, `${title} should fail`);
    assert.match(failures[0], /expected: \(HTPR\|HYFA\)-<n>/);
  }
});

test("PR title retains the current tag and nonempty-summary requirements", async () => {
  for (const title of [
    "HTPR-43 [SECURITY] Unknown tag",
    "HYFA-43 [INFRA] ",
  ]) {
    const failures = await runTitleCheck(title);
    assert.equal(failures.length, 1, `${title} should fail`);
  }
});
