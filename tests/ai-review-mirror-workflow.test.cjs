const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const yaml = require("js-yaml");
const { parse } = require("node-html-parser");
const { loadModule } = require("./helpers/loadModule.cjs");
const { formatRichTextInput } = loadModule("src/utils/helperFunctions/markdownToHtml.ts");
const { sanitizeRichHtml } = loadModule("src/utils/helperFunctions/sanitizeRichHtml.ts");
const { normalizeBlockHtml } = loadModule("src/lib/mcp/normalizeBlockHtml.ts");

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
  postResponse = { status: 200, body: { success: true, routedTo: "log", visibleToPeople: false } },
  preflightResponse = { status: 200, body: { success: true, valid: true, would: { routedTo: "log" } } },
  readResponse,
  board = { activities: [], keys: new Set() },
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
    if (!init.method) {
      const offset = Number(new URL(url).searchParams.get("offset"));
      const response = readResponse ?? { status: 200, body: { success: true, activities: board.activities.slice(offset, offset + 100) } };
      return { ok: response.status < 400, status: response.status, json: async () => response.body };
    }
    if (JSON.parse(init.body).dry_run === true) {
      return { ok: preflightResponse.status < 400, status: preflightResponse.status, json: async () => preflightResponse.body };
    }
    if (postResponse.status < 400 && postResponse.body.success && postResponse.body.routedTo === "log" && !board.keys.has(init.headers["Idempotency-Key"])) {
      board.keys.add(init.headers["Idempotency-Key"]);
      const { text, content_type } = JSON.parse(init.body);
      const html = normalizeBlockHtml(sanitizeRichHtml(formatRichTextInput(text.trim().replace(/\r\n?/g, "\n"), content_type)));
      board.activities.unshift({ id: String(board.keys.size), text: parse(html).structuredText.trim() });
    }
    return { ok: postResponse.status < 400, status: postResponse.status, json: async () => postResponse.body };
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
  return { calls, failures, infos, warnings, posts: calls.filter(call => call.method === "POST" && JSON.parse(call.init.body).dry_run !== true) };
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

test("the verdict is sent only to the agent log", async () => {
  const { calls, posts, failures } = await runMirror();
  assert.deepEqual(failures, []);
  assert.equal(posts.length, 1);
  assert.match(posts[0].url, /\/api\/mcp\/comments$/);
  const body = JSON.parse(posts[0].init.body);
  assert.equal(body.ticket_number, "HTPR-1234");
  assert.equal(body.kind, undefined);
  assert.equal(body.content_type, "html");
  const preflight = calls.find(call => call.method === "POST" && JSON.parse(call.init.body).dry_run === true);
  assert.ok(preflight);
  assert.ok(calls.indexOf(preflight) < calls.indexOf(posts[0]));
  assert.equal(preflight.init.headers?.["Idempotency-Key"], undefined);
  assert.deepEqual(JSON.parse(preflight.init.body), { ...body, dry_run: true });
  assert.match(body.text, /^<p>AI review mirror \[hypertask-ai\/hypertask#43\]: APPROVE<\/p>/);
});

test("five runs across heads deduplicate and verdict transitions are recorded", async () => {
  const board = { activities: [], keys: new Set() };
  for (let i = 0; i < 5; i++) {
    const sha = String(i + 1).repeat(40);
    const pr = productionPr({ head: { ...productionPr().head, sha }, comments: [{ user: REVIEWER, body: REVIEW.replace(SHA, sha) }] });
    const result = await runMirror({ board, pr });
    assert.deepEqual(result.failures, []);
    assert.equal(result.posts.length, i === 0 ? 1 : 0);
    assert.equal(board.activities[0].text, "AI review mirror [hypertask-ai/hypertask#43]: APPROVE\nhttps://github.com/hypertask-ai/hypertask/pull/43");
  }
  for (const verdict of ["CONCERNS", "APPROVE"]) {
    const result = await runMirror({ board, pr: productionPr({ comments: [{ user: REVIEWER, body: REVIEW.replace("APPROVE", verdict) }] }) });
    assert.deepEqual(result.failures, []);
    assert.equal(result.posts.length, 1);
    assert.equal(JSON.parse(result.posts[0].init.body).kind, undefined);
  }
  assert.deepEqual(board.activities.map(a => a.text.split("\n")[0].split(": ").pop()), ["APPROVE", "CONCERNS", "APPROVE"]);
});

test("manual and bot events deduplicate against the same board", async () => {
  for (const first of ["workflow_dispatch", "issue_comment"]) {
    const board = { activities: [], keys: new Set() };
    const second = first === "workflow_dispatch" ? "issue_comment" : "workflow_dispatch";
    const initial = await runMirror({ board, eventName: first, inputs: { pr: "43" } });
    const repeated = await runMirror({ board, eventName: second, inputs: { pr: "43" } });
    assert.deepEqual(initial.failures, []);
    assert.deepEqual(repeated.failures, []);
    assert.equal(initial.posts.length, 1);
    assert.equal(repeated.posts.length, 0);
    assert.equal(board.activities.length, 1);
  }
});

test("pagination finds the latest mirror for this PR behind unrelated activity", async () => {
  const board = { activities: [{ id: "old", text: "AI review mirror [hypertask-ai/hypertask#43]: APPROVE\nurl" }], keys: new Set() };
  board.activities.unshift(...Array.from({ length: 105 }, (_, i) => ({ id: `other-${i}`, text: `AI review mirror [hypertask-ai/hypertask#44]: CONCERNS\nurl` })));
  const result = await runMirror({ board });
  assert.deepEqual(result.failures, []);
  assert.equal(result.posts.length, 0);
  assert.match(result.calls[1].url, /offset=100/);
});

test("preflight failures never write a verdict", async () => {
  for (const preflightResponse of [
    { status: 200, body: { success: true, valid: true, would: { routedTo: "comments" } } },
    { status: 503, body: { success: false } },
    { status: 200, body: null },
    { status: 200, body: { success: true, would: { routedTo: "log" } } },
  ]) {
    const result = await runMirror({ preflightResponse });
    assert.equal(result.failures.length, 1);
    assert.equal(result.posts.length, 0);
    assert.equal(result.calls.filter(call => call.method === "POST").length, 1);
  }
});

test("failed reads and unconfirmed log routing fail without fallback", async () => {
  for (const readResponse of [
    { status: 503, body: { success: false } },
    { status: 200, body: { success: false } },
    { status: 200, body: { success: true, activities: [{}] } },
  ]) {
    const result = await runMirror({ readResponse });
    assert.equal(result.failures.length, 1);
    assert.equal(result.posts.length, 0);
  }
  for (const postResponse of [
    { status: 503, body: { success: false } },
    { status: 200, body: { success: true } },
    { status: 200, body: { success: true, routedTo: "comments", visibleToPeople: true } },
    { status: 200, body: { success: true, routedTo: "log", visibleToPeople: true } },
  ]) {
    const result = await runMirror({ postResponse });
    assert.equal(result.failures.length, 1);
    assert.equal(result.posts.length, 1);
    assert.equal(JSON.parse(result.posts[0].init.body).kind, undefined);
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
  assert.equal(JSON.parse(yper.posts[0].init.body).ticket_number, "YPER4-675");

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

test("no review text or markup is copied into the log", async () => {
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
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.equal(workflow.concurrency.group, "ai-review-mirror-${{ github.event.issue.number || inputs.pr }}");
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
