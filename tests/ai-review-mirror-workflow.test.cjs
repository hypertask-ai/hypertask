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
  ticketComments = [],
  postResponse = { status: 200, body: { success: true, url: "https://app.hypertask.ai/detail/project-15/1234" } },
  token = "test-token",
  rateLimitReads = 0,
  rateLimitCommentRead = false,
} = {}) {
  const calls = [];
  const failures = [];
  const infos = [];
  const warnings = [];
  let refusedReads = rateLimitReads;
  // The exact 403 a saturated App installation returns: no room left in the
  // hourly window, resetting in a moment (YPER4-925).
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
    const method = init.method ?? "GET";
    calls.push({ url, method, init });
    if (method === "GET") {
      return { ok: true, status: 200, json: async () => ({ success: true, comments: ticketComments }) };
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
  // The step imports the shared retry helper from the checked-out production
  // scripts, which in the runner is the workspace root.
  process.env.GITHUB_WORKSPACE = process.cwd();
  if (token === null) delete process.env.HYPERTASK_MCP_TOKEN;
  else process.env.HYPERTASK_MCP_TOKEN = token;
  // The step reads this from the workflow env; without it no comment is the
  // reviewer's and every path here would skip.
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
  return { calls, failures, infos, warnings, posts: calls.filter(call => call.method === "POST") };
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

test("the review verdict lands in the ticket thread with the reviewed commit", async () => {
  const { posts, failures } = await runMirror();

  assert.deepEqual(failures, []);
  assert.equal(posts.length, 1);
  assert.match(posts[0].url, /\/api\/mcp\/comments$/);
  assert.equal(posts[0].init.headers["Idempotency-Key"], `ai-review-mirror-43-${SHA}`);
  const body = JSON.parse(posts[0].init.body);
  assert.equal(body.ticket_number, "HTPR-1234");
  // Without a kind, an agent comment is filed in the hidden agent log.
  assert.equal(body.kind, "qa");
  assert.match(body.text, /APPROVE \(minors only: 1\)/);
  assert.match(body.text, /MINOR/);
  assert.ok(body.text.includes(`reviewed-commit: ${SHA}`));
  // Signature and provider comment tags are not findings.
  assert.doesNotMatch(body.text, /ai-review-signature/);
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
  // GitHub names one App account hypertask-ai-review[bot] on a comment event and
  // hypertask-ai-review in the REST payload. The live run mirrored nothing
  // because only one spelling matched.
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

test("the same reviewed commit is not posted to the ticket twice", async () => {
  const { posts, infos } = await runMirror({
    ticketComments: [{ text: `<p><code>reviewed-commit: ${SHA}</code></p>` }],
  });
  assert.deepEqual(posts, []);
  assert.match(infos.join("\n"), /already carries the verdict/);
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

test("findings are escaped so the ticket renders them as text", async () => {
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
  assert.match(text, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.match(text, /a &amp; b &lt;b&gt;/);
});

test("a rejected post fails the run instead of hiding behind continue-on-error (YPER4-675)", async () => {
  const { failures } = await runMirror({
    postResponse: { status: 401, body: { success: false, error: "Unauthorized" } },
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /HTTP 401/);
  assert.match(failures[0], /Unauthorized/);
});

test("a read the app does not confirm fails the run", async () => {
  const { failures } = await runMirror({ postResponse: { status: 500, body: { success: false } } });
  const readFailure = await runMirror({ ticketComments: null });
  assert.equal(failures.length, 1);
  // null comments is not an array, so the run must stop before posting.
  assert.match(readFailure.failures[0], /was not confirmed by the app/);
  assert.deepEqual(readFailure.posts, []);
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
  // The one checkout is the shared production scripts for the rate-limit
  // retry, never the pull request under review.
  assert.equal(checkout.with.ref, "production");
  assert.equal(checkout.with["persist-credentials"], false);
  assert.equal(checkout.with["sparse-checkout"], ".github/scripts");
  assert.deepEqual(workflow.permissions, { contents: "read", "pull-requests": "read" });
  for (const step of workflow.jobs.mirror.steps) {
    assert.equal(step.run, undefined, "no shell step may run candidate input");
  }
  assert.deepEqual(workflow.on.issue_comment.types, ["created", "edited"]);
  assert.equal(workflow.on.workflow_dispatch.inputs.pr.required, true);
  // An ordinary comment must not cancel the reviewer's delivery.
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.match(workflow.concurrency.group, /github\.event\.comment\.user\.login/);
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
  // The live run failed on this read: 403, x-ratelimit-remaining 0, resetting
  // 82 seconds later, and the verdict never reached the ticket.
  const { posts, failures, warnings } = await runMirror({ rateLimitReads: 1, rateLimitCommentRead: true });

  assert.deepEqual(failures, []);
  assert.equal(posts.length, 1);
  assert.match(JSON.parse(posts[0].init.body).text, /APPROVE/);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /rate limited; retrying after \d+s/);
});
