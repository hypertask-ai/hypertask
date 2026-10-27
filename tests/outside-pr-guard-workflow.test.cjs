const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile, access } = require("node:fs/promises");
const yaml = require("js-yaml");

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const workflowPath = ".github/workflows/outside-pr-guard.yml";
const base = "hypertask-ai/hypertask";
const marker = "<!-- outside-pr-guard -->";

async function loadWorkflow() {
  return yaml.load(await readFile(workflowPath, "utf8"));
}

function assertSafeSteps(steps) {
  assert.equal(steps.length, 1);
  assert.equal(
    steps[0].uses,
    "actions/github-script@60a0d83039c74a4aee543508d2ffcb1c3799cdea",
  );
  assert.ok(steps.every((step) => !step.uses?.startsWith("actions/checkout")));
  assert.ok(steps.every((step) => !step.run));
}

async function runGuard({
  head = "outsider/hypertask",
  login = "outsider",
  type = "User",
  permission = "none",
  permissionError,
  comments = [],
  eventName = "pull_request_target",
  inputs = {},
  commentError,
} = {}) {
  const workflow = await loadWorkflow();
  const calls = { gets: [], permissions: [], lists: [], writes: [] };
  const logs = [];
  const summaries = [];
  const failures = [];
  const listComments = () => {};
  const summary = {
    addRaw(message) {
      summaries.push(message);
      return this;
    },
    async write() {},
  };

  await new AsyncFunction("github", "context", "core", workflow.jobs["outside-pr-guard"].steps[0].with.script)(
    {
      rest: {
        pulls: {
          async get(params) {
            calls.gets.push(params);
            return { data: {
              number: 347,
              user: { login, type },
              head: { repo: head === null ? null : { full_name: head } },
              base: { repo: { full_name: base } },
            } };
          },
          async update(params) {
            calls.writes.push({ kind: "close", ...params });
          },
        },
        repos: {
          async getCollaboratorPermissionLevel(params) {
            calls.permissions.push(params);
            if (permissionError) throw permissionError;
            return { data: { permission } };
          },
        },
        issues: {
          listComments,
          async createComment(params) {
            if (commentError) throw commentError;
            calls.writes.push({ kind: "comment", ...params });
          },
        },
      },
      async paginate(method, params) {
        assert.equal(method, listComments);
        calls.lists.push(params);
        return comments;
      },
    },
    {
      eventName,
      payload: eventName === "pull_request_target"
        ? { pull_request: { number: 347, user: { login: "stale-author" } }, inputs }
        : { inputs },
      repo: { owner: "hypertask-ai", repo: "hypertask" },
    },
    {
      info(message) { logs.push(message); },
      setFailed(message) { failures.push(message); },
      summary,
    },
  );
  assert.deepEqual(summaries, logs);
  return { calls, logs, summaries, failures };
}

function assertClosed(result, { comment = true } = {}) {
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.calls.writes.map((call) => call.kind), comment ? ["comment", "close"] : ["close"]);
  const close = result.calls.writes.at(-1);
  assert.deepEqual(close, {
    kind: "close", owner: "hypertask-ai", repo: "hypertask", pull_number: 347, state: "closed",
  });
  assert.match(result.logs[0], /: outside \(/);
}

function apiError(status) {
  return Object.assign(new Error(`API ${status}`), { status });
}

test("workflow has safe triggers, permissions, concurrency and a pinned metadata-only job", async () => {
  const workflow = await loadWorkflow();
  assert.deepEqual(Object.keys(workflow.on).sort(), ["pull_request_target", "workflow_dispatch"]);
  assert.deepEqual(workflow.on.pull_request_target, { types: ["opened", "reopened"] });
  const inputs = workflow.on.workflow_dispatch.inputs;
  assert.deepEqual(Object.keys(inputs).sort(), ["pr_number", "simulate_author", "simulate_fork"]);
  for (const name of ["pr_number", "simulate_author"]) {
    assert.equal(inputs[name].type, "string");
    assert.equal(inputs[name].required, false);
  }
  assert.equal(inputs.simulate_fork.type, "boolean");
  assert.equal(inputs.simulate_fork.default, false);
  assert.deepEqual(workflow.permissions, { "pull-requests": "write", contents: "read" });
  assert.match(workflow.concurrency.group, /github\.event\.pull_request\.number/);
  assert.match(workflow.concurrency.group, /inputs\.pr_number/);
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.deepEqual(Object.keys(workflow.jobs), ["outside-pr-guard"]);
  const job = workflow.jobs["outside-pr-guard"];
  assert.equal(job.name, "outside-pr-guard");
  assert.equal(job["runs-on"], "ubuntu-latest");
  assert.equal(job["timeout-minutes"], 5);
  assertSafeSteps(job.steps);
  assert.throws(() => assertSafeSteps([{ uses: "actions/checkout@v4" }]), assert.AssertionError);
  assert.match(await readFile(workflowPath, "utf8"), /^# pull_request_target.*never checks out PR code/);
});

test("same-repo Dependabot branch is trusted without permission lookup or writes", async () => {
  const result = await runGuard({ head: base, login: "dependabot[bot]", type: "Bot", permissionError: apiError(500) });
  assert.deepEqual(result.calls.permissions, []);
  assert.deepEqual(result.calls.writes, []);
  assert.deepEqual(result.calls.lists, []);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.logs, [`PR #347 by dependabot[bot] from ${base}: trusted (same-repo branch)`]);
  assert.deepEqual(result.calls.gets, [{ owner: "hypertask-ai", repo: "hypertask", pull_number: 347 }]);
});

test("fork collaborators with write, admin or maintain access are untouched", async () => {
  for (const permission of ["write", "admin", "maintain"]) {
    const result = await runGuard({ login: "teammate", permission });
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.calls.writes, []);
    assert.deepEqual(result.calls.permissions, [{ owner: "hypertask-ai", repo: "hypertask", username: "teammate" }]);
    assert.match(result.logs[0], new RegExp(`trusted \\(author has ${permission} access\\)`));
  }
});

test("fork outsider with permission 404 gets a friendly comment before closing", async () => {
  const result = await runGuard({ permissionError: apiError(404) });
  assertClosed(result);
  const comment = result.calls.writes[0];
  assert.equal(comment.issue_number, 347);
  assert.equal(comment.owner, "hypertask-ai");
  assert.equal(comment.repo, "hypertask");
  assert.ok(comment.body.includes(marker));
  assert.match(comment.body, /Thanks.*does not accept pull requests from outside the team/);
  assert.match(comment.body, /https:\/\/github\.com\/hypertask-ai\/hypertask\/issues\/new/);
  assert.match(comment.body, /team will pick it up/);
  assert.match(comment.body, /https:\/\/github\.com\/hypertask-ai\/hypertask\/blob\/HEAD\/CONTRIBUTING\.md/);
});

test("fork users with read or none access are closed", async () => {
  for (const permission of ["read", "none"]) assertClosed(await runGuard({ permission }));
});

test("reopened PR with an existing marker closes without a second comment", async () => {
  const result = await runGuard({ comments: [{ body: "unrelated" }, { body: `${marker}\nAlready explained.` }] });
  assertClosed(result, { comment: false });
  assert.deepEqual(result.calls.lists, [{ owner: "hypertask-ai", repo: "hypertask", issue_number: 347 }]);
});

test("dispatch simulated fork outsider logs outside without fetching a PR or writing", async () => {
  for (const simulate_fork of [true, "true"]) {
    const result = await runGuard({ eventName: "workflow_dispatch", inputs: { simulate_author: "visitor", simulate_fork }, permissionError: apiError(404) });
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.calls.gets, []);
    assert.deepEqual(result.calls.writes, []);
    assert.deepEqual(result.calls.lists, []);
    assert.deepEqual(result.logs, ["PR #0 by visitor from visitor/hypertask: outside (author is not a collaborator)"]);
    assert.equal(result.calls.permissions[0].username, "visitor");
  }
});

test("dispatch default simulation and real PR inspection are always dry runs", async () => {
  for (const simulate_fork of [undefined, false, "false"]) {
    const sameRepo = await runGuard({ eventName: "workflow_dispatch", inputs: { simulate_author: "visitor", simulate_fork } });
    assert.match(sameRepo.logs[0], /trusted \(same-repo branch\)/);
    assert.deepEqual(sameRepo.calls.writes, []);
  }
  const real = await runGuard({ eventName: "workflow_dispatch", inputs: { pr_number: "347" } });
  assert.deepEqual(real.failures, []);
  assert.match(real.logs[0], /: outside \(author has none access\)/);
  assert.deepEqual(real.calls.gets, [{ owner: "hypertask-ai", repo: "hypertask", pull_number: 347 }]);
  assert.deepEqual(real.calls.writes, []);
  assert.deepEqual(real.calls.lists, []);
});

test("permission API 500 or 403 fails visibly without comments or closing", async () => {
  for (const status of [500, 403]) {
    const result = await runGuard({ permissionError: apiError(status) });
    assert.deepEqual(result.failures, [`outside-pr-guard failed: API ${status}`]);
    assert.deepEqual(result.calls.writes, []);
    assert.deepEqual(result.calls.lists, []);
  }
});

test("deleted head repo counts as a fork and still respects collaborator access", async () => {
  const outsider = await runGuard({ head: null, permissionError: apiError(404) });
  assertClosed(outsider);
  assert.match(outsider.logs[0], /from \(deleted fork\): outside/);
  const teammate = await runGuard({ head: null, permission: "write" });
  assert.match(teammate.logs[0], /trusted \(author has write access\)/);
  assert.deepEqual(teammate.calls.writes, []);
});

test("only the exact Dependabot Bot identity bypasses fork permission lookup", async () => {
  const bot = await runGuard({ login: "dependabot[bot]", type: "Bot", permissionError: apiError(500) });
  assert.deepEqual(bot.calls.permissions, []);
  assert.deepEqual(bot.calls.writes, []);
  assert.deepEqual(bot.failures, []);
  assert.match(bot.logs[0], /trusted \(Dependabot bot\)/);
  assertClosed(await runGuard({ login: "other[bot]", type: "Bot" }));
  assertClosed(await runGuard({ login: "dependabot[bot]", type: "User" }));
});

test("missing dispatch inputs fail safely and comment errors do not close PRs", async () => {
  const missing = await runGuard({ eventName: "workflow_dispatch" });
  assert.equal(missing.failures.length, 1);
  assert.deepEqual(missing.calls.gets, []);
  assert.deepEqual(missing.calls.writes, []);
  const commentFailed = await runGuard({ commentError: apiError(500) });
  assert.deepEqual(commentFailed.failures, ["outside-pr-guard failed: API 500"]);
  assert.deepEqual(commentFailed.calls.writes, []);
});

test("real PR events cannot use dispatch simulation to avoid closing outsiders", async () => {
  assertClosed(await runGuard({ inputs: { simulate_author: "trusted", simulate_fork: false } }));
});

test("contribution documentation directs outside contributions and security reports to issues", async () => {
  const contributing = await readFile("CONTRIBUTING.md", "utf8");
  assert.match(contributing, /GitHub issues.*https:\/\/github\.com\/hypertask-ai\/hypertask\/issues\/new/);
  assert.match(contributing, /bug.*idea/);
  assert.match(contributing, /team does the code work/);
  assert.match(contributing, /outside the team are closed automatically.*outside-pr-guard/);
  const hasSecurity = await access("SECURITY.md").then(() => true, () => false);
  assert.match(contributing, hasSecurity ? /SECURITY\.md/ : /security reports, open an issue without sensitive details/);
  assert.match(await readFile("README.md", "utf8"), /\[CONTRIBUTING\.md\]\(CONTRIBUTING\.md\)/);
  for (const file of [workflowPath, "CONTRIBUTING.md", "README.md", "tests/outside-pr-guard-workflow.test.cjs"]) {
    assert.ok(!(await readFile(file, "utf8")).includes(String.fromCodePoint(0x2014)), `${file} must not contain em dashes`);
  }
  assert.ok("positive control".concat(String.fromCodePoint(0x2014)).includes(String.fromCodePoint(0x2014)));
});

test("test inventory discovers the guard and changed-test selection includes it", async () => {
  const { discoverTestFiles } = await import("../scripts/test-inventory.mjs");
  const { selectTests } = await import("../.github/scripts/select-tests.mjs");
  const file = "tests/outside-pr-guard-workflow.test.cjs";
  const inventory = await discoverTestFiles({ root: process.cwd(), testsRoot: `${process.cwd()}/tests` });
  assert.ok(inventory.supported.includes(file));
  const selected = await selectTests([file]);
  assert.ok(selected === "ALL" || selected.includes(file));
  assert.equal(await selectTests([workflowPath]), "ALL");
});
