const assert = require("node:assert/strict");
const { readFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const lane = require("../.github/scripts/dependabot-lane.cjs");

const root = join(__dirname, "..");
const read = file => readFileSync(join(root, file), "utf8");

const SEROVAL = {
  number: 2460,
  title: "Bump seroval from 1.6.9 to 1.6.12",
  body: "Bumps [seroval](https://github.com/lxsmnsyc/seroval) from 1.6.9 to 1.6.12.",
  user: { login: "app/dependabot" },
  base: { ref: "production" },
  state: "open",
  draft: false,
  node_id: "PR_kw2460",
  auto_merge: null,
  mergeable: true,
  mergeable_state: "clean",
  html_url: "https://github.com/hypertask-ai/hypertask/pull/2460",
  labels: [{ name: "dependencies" }, { name: "javascript" }],
};
const HONO = {
  number: 2462,
  title: "HTPR-8421 [INFRA] Bump @hono/node-server from 1.19.17 to 2.1.5",
  body: "Bumps [@hono/node-server](https://github.com/honojs/node-server) from 1.19.17 to 2.1.5.",
  user: { login: "app/dependabot" },
  base: { ref: "production" },
  state: "open",
  draft: false,
  node_id: "PR_kw2462",
  auto_merge: { enabled_by: "someone" },
  mergeable: true,
  mergeable_state: "clean",
  html_url: "https://github.com/hypertask-ai/hypertask/pull/2462",
  labels: [{ name: "dependencies" }, { name: "stack-minor" }],
};

function harness({ pulls, comments = {}, failLabel = false, armFails = false, disarmFails = false,
  failGet = [], failReadbackAt = 0, search, create, searchFails = false, createFails = false,
  commentFails = false, pat = true, token = "mcp-token", event = "pull_request_target",
  autoMergeSetting = true } = {}) {
  const state = {
    pulls: pulls.map(pull => ({ ...pull, labels: [...pull.labels] })),
    comments,
    added: [],
    removed: [],
    posted: [],
    graphql: [],
    read: [],
    created: [],
    labelsPulled: [],
    failures: [],
    listCalls: 0,
  };
  const find = number => state.pulls.find(pull => pull.number === number);
  const github = {
    rest: {
      repos: {
        get: async () => {
          state.repoReads = (state.repoReads || 0) + 1;
          return { data: { allow_auto_merge: autoMergeSetting } };
        },
      },
      pulls: {
        get: async ({ pull_number }) => {
          if (failGet.includes(pull_number)) throw new Error("pull request api 502");
          state.read.push(pull_number);
          if (state.read.length === failReadbackAt) throw new Error("pull request readback 502");
          return { data: JSON.parse(JSON.stringify(find(pull_number))) };
        },
        list: async () => {
          state.listCalls++;
          return { data: state.pulls.map(pull => ({ number: pull.number, state: pull.state, base: pull.base, user: pull.user })) };
        },
      },
      issues: {
        addLabels: async ({ issue_number, labels }) => {
          if (failLabel) throw new Error("label api 500");
          state.added.push({ issue_number, labels });
          const pull = find(issue_number);
          for (const name of labels) if (!pull.labels.some(label => label.name === name)) pull.labels.push({ name });
          return { data: [] };
        },
        removeLabel: async ({ issue_number, name }) => {
          const pull = find(issue_number);
          if (!pull.labels.some(label => label.name === name)) {
            throw Object.assign(new Error("Label does not exist"), { status: 404 });
          }
          state.removed.push({ issue_number, name });
          pull.labels = pull.labels.filter(label => label.name !== name);
          return { data: [] };
        },
        listComments: async ({ issue_number }) => ({
          data: (state.comments[issue_number] || []).map(body => ({ body })),
        }),
        createComment: async ({ issue_number, body }) => {
          if (commentFails) throw new Error("comment api 422");
          state.posted.push({ issue_number, body });
          (state.comments[issue_number] ||= []).push(body);
          return { data: {} };
        },
      },
    },
    graphql: async (query, variables) => {
      state.graphql.push({ query, id: variables.id });
      const pull = state.pulls.find(candidate => candidate.node_id === variables.id);
      if (query.includes("enablePullRequestAutoMerge")) {
        if (armFails) throw new Error("Pull request is not mergeable");
        pull.auto_merge = { enabled_by: "ci" };
        return { enablePullRequestAutoMerge: { pullRequest: { number: pull.number } } };
      }
      if (disarmFails) throw new Error("Auto-merge is not enabled");
      pull.auto_merge = null;
      return { disablePullRequestAutoMerge: { actor: { login: "ci" } } };
    },
    paginate: async (fn, params) => (await fn(params)).data,
  };
  const core = {
    info: () => {},
    warning: () => {},
    failures: state.failures,
    setFailed: message => state.failures.push(message),
  };
  const fetched = [];
  const fetchImpl = async (url, init) => {
    fetched.push({ url, init });
    const respond = (ok, body) => ({ ok, status: ok ? 200 : 500, json: async () => body });
    if (url.includes("/tasks/search")) {
      if (searchFails) return respond(false, {});
      return respond(true, search === undefined ? { tasks: [] } : search);
    }
    if (url.includes("/tasks/create")) {
      if (createFails) return respond(false, {});
      state.created.push(JSON.parse(init.body));
      return respond(true, create === undefined ? { task: { ticketNumber: "HTPR-9001" } } : create);
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const context = {
    eventName: event,
    repo: { owner: "hypertask-ai", repo: "hypertask" },
    serverUrl: "https://github.com",
    runId: 4242,
    payload: event === "pull_request_target" ? { pull_request: { number: pulls[0].number } } : {},
  };
  const run = () => lane({ github, context, core, fetchImpl, env: { MCP_TOKEN: token, PAT_PRESENT: pat ? "true" : "" }, sleep: async () => {} });
  return { state, run, fetched, core };
}

test("classifies the two incident pull requests", () => {
  assert.deepEqual(lane.laneOf(SEROVAL).major, false, "seroval 1.6.9 -> 1.6.12 is a small bump");
  assert.equal(lane.laneOf(HONO).major, true, "@hono/node-server 1.19.17 -> 2.1.5 is a major bump");
});

test("pre-1.0 minors and unreadable titles fail closed to major", () => {
  assert.equal(lane.laneOf({ title: "Bump @better-auth/infra from 0.4.9 to 0.5.10" }).major, true);
  assert.equal(lane.laneOf({ title: "Bump @better-auth/infra from 0.4.9 to 0.4.10" }).major, false);
  assert.equal(lane.laneOf({ title: "Bump pacote and npm" }).major, true);
  assert.equal(lane.laneOf({ title: "Bump vue from 3.2.0 to 3.2.1", body: "prefix from 1.0.0 to 2.0.0 in prose" }).major, false,
    "a version pair in prose must not override an explicit small title pair");
});

test("a grouped stack-minor PR is read row by row from its body table", () => {
  const table = (rows) => ["| Package | From | To |", "| --- | --- | --- |",
    ...rows.map(([pkg, from, to]) => `| \`${pkg}\` | \`${from}\` | \`${to}\` |`)].join("\n");
  const title = "Build(deps): Bump the stack-minor group across 1 directory with 2 updates";
  assert.equal(lane.laneOf({ title, body: table([["a", "1.2.3", "1.2.9"], ["b", "3.1.0", "3.4.0"]]) }).major, false);
  assert.equal(lane.laneOf({ title, body: table([["a", "1.2.3", "1.2.9"], ["b", "0.3.7", "0.4.0"]]) }).major, true,
    "a pre-1.0 member rides the group as a major");
  assert.equal(lane.laneOf({ title, body: table([["a", "1.2.3", "1.2.9"]]) + "\n| broken |" }).major, true,
    "a malformed row is not evidence of a small bump");
  assert.equal(lane.laneOf({ title, body: "" }).major, true, "no table at all fails closed");
});

test("a small bump is labelled and auto-merged, and files no ticket", async () => {
  const { state, run } = harness({ pulls: [SEROVAL] });
  await run();
  assert.deepEqual(state.added, [{ issue_number: 2460, labels: ["full-ci", "stack-minor"] }]);
  assert.deepEqual(state.removed, [], "there was no stale lane label to remove");
  assert.equal(state.graphql.length, 1);
  assert.match(state.graphql[0].query, /enablePullRequestAutoMerge/);
  assert.deepEqual(state.created, [], "a small bump needs no board ticket");
  assert.deepEqual(state.failures, []);
});

test("a major bump disarms auto-merge, is labelled major, and files its ticket", async () => {
  const { state, run, fetched } = harness({ pulls: [HONO] });
  await run();
  assert.match(state.graphql[0].query, /disablePullRequestAutoMerge/, "the armed major is disarmed first");
  assert.equal(state.pulls[0].auto_merge, null);
  assert.deepEqual(state.added, [{ issue_number: 2462, labels: ["full-ci", "major-upgrade"] }]);
  assert.deepEqual(state.removed, [{ issue_number: 2462, name: "stack-minor" }]);
  assert.equal(state.created.length, 1);
  const [ticket] = state.created;
  assert.equal(ticket.title, "Stack upgrade: @hono/node-server 1.19.17 -> 2.1.5 [dep-pr-2462]");
  assert.equal(ticket.project_id, 15);
  assert.equal(ticket.section_id, 4389, "the Bugs column of board 15");
  assert.match(ticket.description, /pull\/2462/);
  assert.ok(fetched.some(call => call.url.includes("q=dep-pr-2462")), "the board is searched before creating");
  const link = state.posted.find(comment => comment.body.includes("<!-- stack-upgrade-ticket -->"));
  assert.ok(link, "the PR is linked to its ticket");
  assert.match(link.body, /HTPR-9001/);
  assert.doesNotMatch(state.graphql[0].query, /enableAutoMerge/);
  assert.deepEqual(state.failures, []);
});

test("a relink finds the existing ticket instead of filing a second one", async () => {
  const { state, run } = harness({
    pulls: [HONO],
    search: { tasks: [{ ticketNumber: "HTPR-8421", title: "Stack upgrade: agent connection library 2.1 [dep-pr-2462]" }] },
  });
  await run();
  assert.deepEqual(state.created, []);
  assert.ok(state.posted.some(comment => /HTPR-8421/.test(comment.body)), "the existing ticket is relinked");
});

test("a failed board search never becomes a duplicate ticket", async () => {
  const { state, run } = harness({ pulls: [HONO], searchFails: true });
  await run();
  assert.deepEqual(state.created, []);
  assert.equal(state.failures.length, 1);
  assert.match(state.failures[0], /#2462 .*board search failed/);
});

test("a label that cannot be written shows up on the PR and fails the run", async () => {
  const { state, run } = harness({ pulls: [SEROVAL], failLabel: true });
  await run();
  assert.equal(state.failures.length, 1);
  assert.match(state.failures[0], /#2460/);
  const gap = state.posted.find(comment => comment.body.includes("<!-- dependabot-lane-missing -->"));
  assert.ok(gap, "the PR itself carries the problem");
  assert.match(gap.body, /labelling it "stack-minor" failed/);
});

test("the ticket is filed even when the label cannot be written", async () => {
  const { state, run } = harness({ pulls: [HONO], failLabel: true });
  await run();
  assert.equal(state.created.length, 1, "an owner beats a label");
  assert.match(state.failures[0], /#2462/);
});

test("a failed disarm readback still files the major's ticket", async () => {
  const { state, run } = harness({ pulls: [HONO], failReadbackAt: 2 });
  await run();
  assert.equal(state.created.length, 1, "an owner is filed even when the disarm cannot be confirmed");
  assert.equal(state.pulls[0].auto_merge, null, "the disarm mutation still ran");
  assert.match(state.failures[0], /auto-merge may still be armed/);
});

test("a failed label readback still files the major's ticket", async () => {
  const { state, run } = harness({ pulls: [HONO], failReadbackAt: 3 });
  await run();
  assert.equal(state.created.length, 1, "a label that cannot be read back never stops the ticket");
  assert.ok(state.added.length, "the label write still ran");
  assert.match(state.failures[0], /reading its labels back failed/);
});

test("a hold label leaves a major's labels alone but still disarms and tickets it", async () => {
  const { state, run } = harness({ pulls: [{ ...HONO, labels: [{ name: "hold" }, { name: "stack-minor" }] }] });
  await run();
  assert.deepEqual(state.added, [], "a held pull request keeps its labels");
  assert.equal(state.pulls[0].auto_merge, null, "a held major is still disarmed");
  assert.equal(state.created.length, 1, "and it still gets an owner");
  assert.deepEqual(state.failures, []);
});

test("an arming failure on a clean pull request is reported", async () => {
  const { state, run } = harness({ pulls: [SEROVAL], armFails: true });
  await run();
  assert.match(state.failures[0], /auto-merge could not be armed/);
});

test("an arming failure while the pull request is still settling is only logged", async () => {
  const { state, run } = harness({ pulls: [{ ...SEROVAL, mergeable_state: "unknown" }], armFails: true });
  await run();
  assert.deepEqual(state.failures, []);
});

test("a missing MCP token is reported instead of passing quietly", async () => {
  const { state, run } = harness({ pulls: [HONO], token: "" });
  await run();
  assert.deepEqual(state.created, []);
  assert.match(state.failures[0], /HYPERTASK_MCP_TOKEN is empty/);
  assert.ok(state.added.length, "the lane label is still written");
});

test("a missing PAT refuses to arm auto-merge but still labels", async () => {
  const { state, run } = harness({ pulls: [SEROVAL], pat: false });
  await run();
  assert.deepEqual(state.graphql, [], "a GITHUB_TOKEN merge would not start the push workflows");
  assert.ok(state.added.length);
  assert.match(state.failures[0], /AUTOMERGE_TOKEN is empty/);
});

test("a repository with auto-merge off is respected, not fought", async () => {
  const { state, run } = harness({ pulls: [SEROVAL], autoMergeSetting: false });
  await run();
  assert.deepEqual(state.graphql, [], "never call a mutation the repository forbids");
  assert.ok(state.added.length, "the lane label still lands");
  assert.deepEqual(state.failures, [], "a setting this run may not change must not fail it");
});

test("a hold label stops the run touching that pull request", async () => {
  const { state, run } = harness({ pulls: [{ ...SEROVAL, labels: [{ name: "hold" }] }] });
  await run();
  assert.deepEqual(state.added, []);
  assert.deepEqual(state.graphql, []);
  assert.deepEqual(state.failures, []);
});

test("a draft small bump is labelled now and armed when it is ready", async () => {
  const { state, run } = harness({ pulls: [{ ...SEROVAL, draft: true }] });
  await run();
  assert.deepEqual(state.graphql, []);
  assert.ok(state.added.length);
  assert.deepEqual(state.failures, []);
});

test("one already-linked major is not commented on twice", async () => {
  const { state, run } = harness({
    pulls: [HONO],
    comments: { 2462: ["<!-- stack-upgrade-ticket -->\nTracked on HTPR-8421: https://app.hypertask.ai/detail/project-15/8421"] },
  });
  await run();
  assert.deepEqual(state.created, []);
  assert.deepEqual(state.posted, []);
});

test("the sweep heals every open Dependabot pull request and skips the rest", async () => {
  const human = { ...SEROVAL, number: 3000, user: { login: "valentinyeo" }, title: "Add a page" };
  const wrongBase = { ...SEROVAL, number: 3001, base: { ref: "main" } };
  const { state, run } = harness({ pulls: [SEROVAL, HONO, human, wrongBase], event: "schedule" });
  await run();
  assert.deepEqual(state.added.map(call => call.issue_number).sort(), [2460, 2462],
    "the human PR and the PR against another base are left alone");
  assert.equal(state.created.length, 1, "only the major bump gets a ticket");
});

test("an unreadable pull request fails the run without skipping the rest", async () => {
  const { state, run } = harness({ pulls: [SEROVAL, HONO], event: "schedule", failGet: [2460] });
  await run();
  assert.ok(state.failures.length, "a pull request this sweep cannot read must not pass quietly");
  assert.ok(state.added.some(call => call.issue_number === 2462), "the rest of the sweep still runs");
});

test("the workflow is one event-driven run with a best-effort sweep", () => {
  const workflow = read(".github/workflows/dependabot-lane.yml");
  assert.match(workflow, /name: Dependabot Lane/);
  for (const type of ["opened", "reopened", "synchronize", "ready_for_review"]) {
    assert.ok(new RegExp(`types: \\[[^\\]]*${type}`).test(workflow), `the ${type} event must start the lane`);
  }
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /cancel-in-progress: false/, "a run that files a ticket must not be cancelled halfway");
  assert.match(workflow, /concurrency:\n  group: dependabot-lane\n  queue: max\n  cancel-in-progress: false/, 
    "the sweep and the PR events share one queue, so two runs cannot file a ticket each");
  assert.match(workflow, /timeout-minutes: \d+/);
  assert.match(workflow, /permissions:\n  contents: read\n  pull-requests: write/);
  assert.match(workflow, /require\('\.\/\.github\/scripts\/dependabot-lane\.cjs'\)/);
  assert.doesNotMatch(workflow, /^\s*- labeled/m, "no label event may gate the ticket any more");
  const executable = workflow.split("\n").filter(line => !/^\s*#/.test(line)).join("\n");
  assert.doesNotMatch(executable, /dependabot-stack|dependabot-major-ticket/,
    "no executable line may still point at the deleted workflows");
  assert.equal(existsSync(join(root, ".github/workflows/dependabot-stack.yml")), false, "the disabled labeller is gone");
  assert.equal(existsSync(join(root, ".github/workflows/dependabot-major-ticket.yml")), false, "the chained ticket workflow is gone");
});

test("the CI contract names the workflow that replaced the chain", () => {
  for (const file of ["docs/ci.md", "docs/ci-policy.yml", "docs/ci/04-release-contract.md", ".github/dependabot.yml"]) {
    assert.match(read(file), /dependabot-lane/, `${file} must name the new workflow`);
  }
  assert.doesNotMatch(read("docs/ci-policy.yml"), /dependabot-stack|dependabot-major-ticket/);
});
