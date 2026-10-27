const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const yaml = require("js-yaml");

const checkTitle = require("../.github/scripts/pr-title.cjs");
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
  "REFACTOR",
];

async function runTitleCheck(title) {
  const workflow = yaml.load(
    await readFile(".github/workflows/pr-guards-trusted.yml", "utf8"),
  );
  assert.match(workflow.jobs["pr-guards-trusted"].steps.find(step => step.id === "title").with.script, /pr-title\.cjs/);
  const failures = [];
  const outputs = {};

  await checkTitle({
    github: {
      rest: {
        pulls: {
          get: async () => ({ data: {
            title,
            head: { sha: "a".repeat(40), repo: { full_name: "fixture/title-rule" } },
            base: { ref: "production", repo: { full_name: "hypertask-ai/hypertask" } },
            user: { login: "owner" },
          } }),
        },
      },
    },
    context: {
      payload: { pull_request: { number: 43 } },
      repo: { owner: "hypertask-ai", repo: "hypertask" },
    },
    core: {
      info() {},
      setOutput(name, value) { outputs[name] = value; },
      setFailed(message) {
        failures.push(message);
      },
    },
  });

  assert.deepEqual(outputs, { sha: "a".repeat(40), title });
  return failures;
}

test("PR title accepts HTPR, HYFA and YPER4 tickets with every current work tag", async () => {
  for (const prefix of ["HTPR", "HYFA", "YPER4"]) {
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
    "YPER-43 [INFRA] Short lookalike missing the digit",
    "yper4-43 [INFRA] Lowercase infra-board lookalike",
  ]) {
    const failures = await runTitleCheck(title);
    assert.equal(failures.length, 1, `${title} should fail`);
    assert.match(failures[0], /expected: \(HTPR\|HYFA\|YPER4\)-<n>/);
  }
});

test("PR title retains the current tag and nonempty-summary requirements", async () => {
  for (const title of [
    "HTPR-43 [SECURITY] Unknown tag",
    "HYFA-43 [INFRA] ",
    "YPER4-17 [SECURITY] Unknown tag",
  ]) {
    const failures = await runTitleCheck(title);
    assert.equal(failures.length, 1, `${title} should fail`);
  }
});
