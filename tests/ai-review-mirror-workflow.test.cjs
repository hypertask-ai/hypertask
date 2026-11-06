const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const yaml = require("js-yaml");

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const SHA = "b".repeat(40);
const WORKFLOW = ".github/workflows/ai-review-mirror.yml";
const REVIEWER = { login: "hypertask-ai-review" };
const REVIEW = `APPROVE (minors only: 1) — reviewed by **gpt-6.1-sol**

- **MINOR** — a note

<!-- reviewed-commit: ${SHA} -->
<!-- ai-review-signature: ${"c".repeat(64)} -->`;

const loadScript = async () => yaml.load(await readFile(WORKFLOW, "utf8")).jobs.mirror.steps
  .find(step => step.with?.script).with.script;


async function runMirror({
  eventName = "issue_comment",
  comment = { user: REVIEWER, body: REVIEW },
  issue = { number: 43, pull_request: { url: "https://api.github.com/repos/hypertask-ai/hypertask/pulls/43" } },
  inputs = {},
  pr = productionPr(),
  postResponse = null,
  failStage = "activity",
  store = { activities: [], run: 0 },
  token = "test-token",
  rateLimitReads = 0,
  rateLimitCommentRead = false,
} = {}) {
  const calls = [];
  const failures = [];
  const infos = [];
  const warnings = [];
  let refusedReads = rateLimitReads;
  const refuse = () => {
    assert.ok(refusedReads > 0, "the reads must be refused only as often as the test asks");
    refusedReads -= 1;
    return Object.assign(new Error("API rate limit exceeded for installation."), {
      status: 403,
      response: {
        url: "https://api.github.com/repos/hypertask-ai/hypertask/issues/43/comments?per_page=100",
        headers: {
          "x-ratelimit-limit": "5000",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(Math.floor(Date.now() / 1000)),
        },
      },
    });
  };

  const fetchStub = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", init });
    const path = new URL(url).pathname;
    let body;
    let stage;
    if (path === "/api/mcp/tasks") {
      stage = "task";
      body = { success: true, tasks: [{ id: 1234 }] };
    } else if (path.endsWith("/agent-activity")) {
      stage = "history";
      const offset = Number(new URL(url).searchParams.get("offset"));
      body = { success: true, activities: store.activities.slice(offset, offset + 100) };
    } else if (path === "/api/mcp/agents/runs") {
      stage = "run";
      body = { success: true, run: { id: `run-${++store.run}` } };
    } else if (/\/agents\/runs\/[^/]+\/activities$/.test(path)) {
      stage = "activity";
      assert.ok(!store.closedRuns?.includes(path.split("/")[5]), "cannot post to a closed run");
      const data = JSON.parse(init.body);
      const key = init.headers["Idempotency-Key"];
      let activity = store.activities.find(item => item.runId === `run-${store.run}` && item.key === key);
      if (!activity && !(postResponse && failStage === stage)) {
        activity = { ...data, key, runId: `run-${store.run}`, id: `activity-${store.activities.length + 1}` };
        store.activities.unshift(activity);
      }
      body = { success: true, activity };
    } else {
      throw new Error(`Unexpected request: ${url}`);
    }
    const response = postResponse && failStage === stage ? postResponse : { status: 200, body };
    return { ok: response.status < 400, status: response.status, json: async () => response.body };
  };

  const github = {
    rest: {
      pulls: {
        get: async () => (!rateLimitCommentRead && refusedReads > 0 ? Promise.reject(refuse()) : { data: pr }),
      },
      issues: { listComments: async () => ({ data: [] }) },
    },
    paginate: async () => (refusedReads > 0
      ? Promise.reject(refuse())
      : pr.comments ?? [{ user: REVIEWER, body: REVIEW }]),
  };

  const savedFetch = globalThis.fetch;
  const savedToken = process.env.HYPERTASK_MCP_TOKEN;
  const savedAuthor = process.env.REVIEW_COMMENT_AUTHOR;
  const savedWorkspace = process.env.GITHUB_WORKSPACE;
  globalThis.fetch = fetchStub;
  process.env.GITHUB_WORKSPACE = process.cwd();
  if (token === null) delete process.env.HYPERTASK_MCP_TOKEN;
  else process.env.HYPERTASK_MCP_TOKEN = token;
  process.env.REVIEW_COMMENT_AUTHOR = REVIEWER.login;
  try {
    await new AsyncFunction("github", "context", "core", await loadScript())(
      github,
      { eventName, payload: { issue, comment, inputs }, repo: { owner: "hypertask-ai", repo: "hypertask" } },
      {
        info(message) { infos.push(message); },
        warning(message) { warnings.push(message); },
        setFailed(message) { failures.push(message); },
      },
    );
  } finally {
    globalThis.fetch = savedFetch;
    if (savedWorkspace === undefined) delete process.env.GITHUB_WORKSPACE;
    else process.env.GITHUB_WORKSPACE = savedWorkspace;
    if (savedToken === undefined) delete process.env.HYPERTASK_MCP_TOKEN;
    else process.env.HYPERTASK_MCP_TOKEN = savedToken;
    if (savedAuthor === undefined) delete process.env.REVIEW_COMMENT_AUTHOR;
    else process.env.REVIEW_COMMENT_AUTHOR = savedAuthor;
  }

  assert.equal(refusedReads, 0, "every refused read must have been retried");
  return { calls, failures, infos, warnings, posts: calls.filter(call => /\/activities$/.test(new URL(call.url).pathname) && call.method === "POST") };
}

function productionPr(overrides = {}) {
  return {
    number: 43,
    html_url: "https://github.com/hypertask-ai/hypertask/pull/43",
    base: { ref: "production", repo: { full_name: "hypertask-ai/hypertask" } },
    head: { sha: SHA, ref: "runner3/htpr-1234-something", repo: { full_name: "hypertask-ai/hypertask" } },
    ...overrides,
  };
}

test("five reviews create agent thoughts and never people comments", async () => {
  const store = { activities: [], run: 0 };
  for (let number = 1; number <= 5; number++) {
    const sha = String(number).repeat(40);
    const review = REVIEW.replaceAll(SHA, sha);
    const pr = productionPr({ head: { ...productionPr().head, sha }, comments: [{ user: REVIEWER, body: review }] });
    const result = await runMirror({ pr, store });
    assert.deepEqual(result.failures, []);
    assert.equal(result.posts.length, 1);
    assert.equal(result.calls.some(call => new URL(call.url).pathname === "/api/mcp/comments"), false);
    assert.equal(JSON.parse(result.posts[0].init.body).type, "thought");
  }
  assert.equal(store.activities.length, 5);
  assert.ok(store.activities.every(activity => activity.text.includes("APPROVE")));
});

test("unchanged deliveries deduplicate across runs, but a changed verdict arrives", async () => {
  const store = { activities: [], run: 0 };
  const first = await runMirror({ store });
  const repeat = await runMirror({ store });
  const changed = await runMirror({ store, pr: productionPr({ comments: [{ user: REVIEWER, body: REVIEW.replace("APPROVE", "CONCERNS") }] }) });
  const changedBack = await runMirror({ store });
  const repeatAgain = await runMirror({ store });
  assert.deepEqual([...first.failures, ...repeat.failures, ...changed.failures, ...changedBack.failures, ...repeatAgain.failures], []);
  assert.equal(repeat.posts.length, 0);
  assert.equal(repeatAgain.posts.length, 0);
  assert.equal(store.activities.length, 3);
  assert.deepEqual(store.activities.map(activity => activity.text.match(/^AI review (APPROVE|CONCERNS)/)[1]), ["APPROVE", "CONCERNS", "APPROVE"]);
  assert.match(first.posts[0].init.headers["Idempotency-Key"], new RegExp(`43-${SHA}-APPROVE$`));
  assert.match(changed.posts[0].init.headers["Idempotency-Key"], new RegExp(`43-${SHA}-CONCERNS-activity-1$`));
  assert.match(changedBack.posts[0].init.headers["Idempotency-Key"], new RegExp(`43-${SHA}-APPROVE-activity-2$`));
  assert.equal(store.activities[0].text, store.activities[2].text);
  assert.notEqual(store.activities[0].runId, store.activities[1].runId);
});

test("a closed run remains deduplicated beyond the first history page", async () => {
  const store = { activities: [], run: 0 };
  const first = await runMirror({ store });
  store.closedRuns = [store.activities[0].runId];
  store.activities.unshift(...Array.from({ length: 105 }, (_, i) => ({ id: `other-${i}`, type: "thought", text: `unrelated ${i}` })));
  const repeat = await runMirror({ store });
  assert.deepEqual([...first.failures, ...repeat.failures], []);
  assert.equal(repeat.posts.length, 0);
  assert.equal(store.run, 1);
  assert.equal(repeat.calls.filter(call => call.url.includes("/agent-activity")).length, 2);
});

test("only exact mirror thoughts determine history state", async () => {
  const store = { activities: [], run: 0 };
  await runMirror({ store });
  const text = store.activities[0].text;
  store.activities = [
    { id: "other-1", type: "thought", text: `unrelated ${text}` },
    { id: "other-2", type: "message", text },
  ];
  const result = await runMirror({ store });
  assert.deepEqual(result.failures, []);
  assert.equal(result.posts.length, 1);
});

test("malformed task and history responses fail closed", async () => {
  for (const [failStage, body] of [
    ["task", null],
    ["task", { success: true, tasks: [] }],
    ["history", { success: true, activities: null }],
    ["history", { success: true, activities: [null] }],
    ["history", { success: false, error: "unavailable" }],
  ]) {
    const result = await runMirror({ failStage, postResponse: { status: 200, body } });
    assert.equal(result.failures.length, 1);
    assert.equal(result.posts.length, 0);
    assert.equal(result.calls.some(call => new URL(call.url).pathname === "/api/mcp/agents/runs"), false);
  }
});

test("only the reviewer's comment wakes the mirror and only production PRs are mirrored", async () => {
  const other = await runMirror({ comment: { user: { login: "someone" }, body: REVIEW } });
  assert.deepEqual(other.calls, []);
  assert.match(other.infos.join("\n"), /not hypertask-ai-review/);

  const notProduction = await runMirror({
    pr: productionPr({ base: { ref: "main", repo: { full_name: "hypertask-ai/hypertask" } } }),
  });
  assert.deepEqual(notProduction.posts, []);
  assert.deepEqual(notProduction.failures, []);
});

test("a comment on an issue that is not a pull request costs no API call", async () => {
  const { calls, failures } = await runMirror({ issue: { number: 43 } });
  assert.deepEqual(calls, []);
  assert.deepEqual(failures, []);
});

test("a fork or foreign PR is never mirrored", async () => {
  const forked = await runMirror({
    pr: productionPr({ head: { sha: SHA, ref: "htpr-1234-fix", repo: { full_name: "fork/hypertask" } } }),
  });
  assert.deepEqual(forked.posts, []);
  assert.deepEqual(forked.failures, []);
});

test("a branch that names no ticket is not mirrored", async () => {
  const { posts, failures } = await runMirror({
    pr: productionPr({ head: { sha: SHA, ref: "chore/cleanup", repo: { full_name: "hypertask-ai/hypertask" } } }),
  });
  assert.deepEqual(posts, []);
  assert.deepEqual(failures, []);
});

test("the [bot] spelling of the same reviewer account is mirrored too", async () => {
  const event = await runMirror({ comment: { user: { login: "hypertask-ai-review[bot]" }, body: REVIEW } });
  assert.equal(event.posts.length, 1);

  const rest = await runMirror({
    pr: productionPr({ comments: [{ user: { login: "hypertask-ai-review[bot]" }, body: REVIEW }] }),
  });
  assert.equal(rest.posts.length, 1);
});

test("a lookalike account name is still refused", async () => {
  const impostor = await runMirror({
    pr: productionPr({ comments: [{ user: { login: "hypertask-ai-review-fake" }, body: REVIEW }] }),
  });
  assert.deepEqual(impostor.posts, []);
});

test("YPER4 branches keep their own ticket and a missing marker is not guessed", async () => {
  const yper = await runMirror({
    pr: productionPr({ head: { sha: SHA, ref: "runner3/yper4-675-ticket-mirror", repo: { full_name: "hypertask-ai/hypertask" } } }),
  });
  assert.match(yper.calls[0].url, /ticket_number=YPER4-675/);

  const hyci = await runMirror({ pr: productionPr({ head: { ...productionPr().head, ref: "ci/hyci-133-fix" } }) });
  assert.match(hyci.calls[0].url, /ticket_number=HYCI-133/);

  const unmarked = await runMirror({
    pr: productionPr({ comments: [{ user: REVIEWER, body: "APPROVE — no marker" }] }),
  });
  assert.deepEqual(unmarked.posts, []);
  assert.deepEqual(unmarked.failures, []);
});

test("a verdict for an older head never reaches the ticket as the current one", async () => {
  const older = "d".repeat(40);
  const { posts, infos } = await runMirror({
    pr: productionPr({
      comments: [{
        user: REVIEWER,
        body: `APPROVE — reviewed by **gpt-6.1-sol**\n\n- ok\n<!-- reviewed-commit: ${older} -->`,
      }],
    }),
  });
  assert.deepEqual(posts, []);
  assert.match(infos.join("\n"), /no verdict for head/);
});

test("a PR with no verdict comment yet posts nothing", async () => {
  const { posts, failures } = await runMirror({
    pr: productionPr({ comments: [{ user: REVIEWER, body: "AI review infrastructure failure" }] }),
  });
  assert.deepEqual(posts, []);
  assert.deepEqual(failures, []);
});

test("no review text or markup is copied into the agent activity", async () => {
  const { posts } = await runMirror({
    pr: productionPr({
      comments: [{
        user: REVIEWER,
        body: `CONCERNS — <script>x</script>\n\n- a & b <b>\n<!-- reviewed-commit: ${SHA} -->`,
      }],
    }),
  });
  const text = JSON.parse(posts[0].init.body).text;
  assert.equal(text.includes("<script>"), false, "raw markup must never survive");
  assert.equal(text.includes("a & b"), false, "findings stay on the pull request");
  assert.match(text, /CONCERNS/);
});

test("a rejected post fails the run instead of hiding behind continue-on-error (YPER4-675)", async () => {
  const { failures } = await runMirror({
    postResponse: { status: 401, body: { success: false, error: "Unauthorized" } },
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /HTTP 401/);
  assert.match(failures[0], /Unauthorized/);
});

test("a post the app does not confirm fails the run", async () => {
  const { failures, posts } = await runMirror({ postResponse: { status: 500, body: { success: false } } });
  assert.equal(posts.length, 1);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /HTTP 500/);
});

test("run and activity failures never fall back to people comments", async () => {
  for (const failStage of ["run", "activity"]) {
    const result = await runMirror({ failStage, postResponse: { status: 503, body: { success: false, error: "unavailable" } } });
    assert.equal(result.failures.length, 1);
    assert.equal(result.calls.some(call => new URL(call.url).pathname === "/api/mcp/comments"), false);
  }
});

test("a missing board token fails the run, never a silent skip", async () => {
  const { failures, calls } = await runMirror({ token: null });
  assert.deepEqual(calls, []);
  assert.match(failures[0], /HYPERTASK_MCP_TOKEN is missing/);
});

test("the workflow mirrors no candidate code into the run", async () => {
  const workflow = yaml.load(await readFile(WORKFLOW, "utf8"));
  const [checkout, script] = workflow.jobs.mirror.steps;
  assert.deepEqual(workflow.jobs.mirror.steps.map(step => step.uses), [
    "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
    "actions/github-script@60a0d83039c74a4aee543508d2ffcb1c3799cdea",
  ]);
  assert.equal(checkout.with.ref, "production");
  assert.equal(checkout.with["persist-credentials"], false);
  assert.equal(checkout.with["sparse-checkout"], ".github/scripts");
  assert.deepEqual(workflow.permissions, { contents: "read", "pull-requests": "read" });
  for (const step of workflow.jobs.mirror.steps) {
    assert.equal(step.run, undefined, "no shell step may run candidate input");
  }
  assert.deepEqual(workflow.on.issue_comment.types, ["created", "edited"]);
  assert.equal(workflow.on.workflow_dispatch.inputs.pr.required, true);
  assert.equal(workflow.jobs.mirror.if, "github.event_name == 'workflow_dispatch' || (github.event.issue.pull_request && (github.event.comment.user.login == 'hypertask-ai-review' || github.event.comment.user.login == 'hypertask-ai-review[bot]'))");
  assert.deepEqual(workflow.jobs.mirror.concurrency, {
    group: "ai-review-mirror-${{ github.event.issue.number || inputs.pr }}",
    queue: "max",
  });
  assert.ok(script.env.REVIEW_COMMENT_AUTHOR);
});

test("a rate-limited pull read waits for the reset and still mirrors the verdict (YPER4-925)", async () => {
  const { posts, failures, warnings } = await runMirror({ rateLimitReads: 2 });

  assert.deepEqual(failures, []);
  assert.equal(posts.length, 1);
  assert.match(JSON.parse(posts[0].init.body).text, /APPROVE/);
  assert.equal(warnings.length, 2);
  assert.match(warnings.join("\n"), /rate limited; retrying after \d+s/);
});

test("a rate-limited comment read waits for the reset and still mirrors the verdict (YPER4-925)", async () => {
  const { posts, failures, warnings } = await runMirror({ rateLimitReads: 1, rateLimitCommentRead: true });

  assert.deepEqual(failures, []);
  assert.equal(posts.length, 1);
  assert.match(JSON.parse(posts[0].init.body).text, /APPROVE/);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /rate limited; retrying after \d+s/);
});
