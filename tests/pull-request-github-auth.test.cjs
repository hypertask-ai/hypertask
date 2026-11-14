const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { generateKeyPairSync } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { parseGithubPullRequestUrl } = jiti(
  path.join(root, "src/lib/pullRequests/githubPullRequests.ts"),
);
const { fetchGithubPullRequest, PullRequestLinkError } = jiti(
  path.join(root, "src/lib/pullRequests/taskPullRequests.ts"),
);
const { PULL_REQUEST_LINK_READ_PERMISSIONS, resetPullRequestGithubAuthCache } = jiti(
  path.join(root, "src/lib/pullRequests/githubLinkAuth.ts"),
);

const canonical = "https://github.com/hypertask-ai/hypertask/pull/110";
const foreign = "https://github.com/nodejs/node/pull/1";
const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
  type: "pkcs8",
  format: "pem",
});
const saved = {
  token: process.env.GITHUB_TOKEN,
  id: process.env.GITHUB_PR_LINK_APP_ID,
  key: process.env.GITHUB_PR_LINK_APP_PRIVATE_KEY,
};

function pull(url, id, title) {
  return {
    id,
    html_url: url,
    title,
    state: "open",
    merged_at: null,
    updated_at: "2026-11-11T00:00:00Z",
    base: { repo: { id } },
    head: { sha: "abc123" },
  };
}

function route(calls, repositories, pulls) {
  return async (url, init) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    const authorization = init?.headers?.Authorization ?? null;
    const request = { url: String(url), authorization, body };
    calls.push(request);
    const packed = `${authorization ?? ""} ${body ? JSON.stringify(body) : ""}`;
    assert.equal(packed.includes(String(pem)), false);
    assert.equal(packed.includes("PRIVATE KEY"), false);
    assert.equal(request.url.startsWith("https://api.github.com/"), true);
    if (request.url.endsWith("/app/installations")) {
      return Response.json([{ id: 77, suspended_at: null }]);
    }
    if (request.url.includes("/access_tokens")) {
      const name = body?.repositories ? "read-token" : "list-token";
      return Response.json(
        { token: name, expires_at: new Date(Date.now() + 3600_000).toISOString() },
        { status: 201 },
      );
    }
    if (request.url.includes("/installation/repositories")) {
      return Response.json({ repositories });
    }
    if (request.url.includes("/check-runs")) {
      return Response.json({
        total_count: 1,
        check_runs: [{ status: "completed", conclusion: "success" }],
      });
    }
    const found = pulls(request);
    return found instanceof Response ? found : Response.json(found);
  };
}

async function withApp(appId, repositories, pulls, run) {
  const calls = [];
  const original = global.fetch;
  delete process.env.GITHUB_TOKEN;
  process.env.GITHUB_PR_LINK_APP_ID = appId;
  process.env.GITHUB_PR_LINK_APP_PRIVATE_KEY = pem;
  resetPullRequestGithubAuthCache();
  global.fetch = route(calls, repositories, pulls);
  try {
    await run(calls);
  } finally {
    global.fetch = original;
    resetPullRequestGithubAuthCache();
  }
}

test("fetchGithubPullRequest uses a read-only token for public installation repositories", async () => {
  const publicRepos = [
    { name: "hypertask", private: false },
    { name: "secret", private: true },
    { name: "unmarked" },
  ];
  try {
    await withApp("424242", publicRepos, (request) => {
      if (request.url.includes("/nodejs/node/")) return pull(foreign, 1, "Foreign public");
      return pull(canonical, 110, "Linked property");
    }, async (calls) => {
      const metadata = await fetchGithubPullRequest(parseGithubPullRequestUrl(canonical));
      const other = await fetchGithubPullRequest(parseGithubPullRequestUrl(foreign));
      assert.equal(metadata.title, "Linked property");
      assert.equal(other.title, "Foreign public");
      const narrow = calls.filter((call) => call.body?.repositories);
      assert.equal(narrow.length, 1);
      assert.deepEqual(narrow[0].body.permissions, PULL_REQUEST_LINK_READ_PERMISSIONS);
      assert.deepEqual(narrow[0].body.repositories, ["hypertask"]);
      assert.equal(JSON.stringify(narrow[0].body).includes("write"), false);
      assert.deepEqual(
        calls.filter((call) => call.url.includes("/pulls/")).map((call) => call.authorization),
        ["Bearer read-token", "Bearer read-token"],
      );
    });

    await withApp("424242", [{ name: "hypertask", private: false }], (request) => {
      if (request.authorization) return new Response("missing", { status: 404 });
      return pull(canonical, 110, "Anonymous public");
    }, async (calls) => {
      const metadata = await fetchGithubPullRequest(parseGithubPullRequestUrl(canonical));
      assert.equal(metadata.title, "Anonymous public");
      assert.deepEqual(
        calls.filter((call) => call.url.includes("/pulls/110")).map((call) => call.authorization),
        ["Bearer read-token", null],
      );
    });

    process.env.GITHUB_TOKEN = "scoped-token";
    const denied = [];
    const original = global.fetch;
    resetPullRequestGithubAuthCache();
    global.fetch = route(denied, [], () => new Response("missing", { status: 404 }));
    try {
      await assert.rejects(
        fetchGithubPullRequest(parseGithubPullRequestUrl(canonical)),
        (error) => error instanceof PullRequestLinkError && error.code === "pr_not_found",
      );
    } finally {
      global.fetch = original;
    }
    assert.equal(denied.length, 1);
    assert.equal(denied[0].authorization, "Bearer scoped-token");

    await withApp("424243", [{ name: "secret", private: true }], () => pull(canonical, 110, "Still anonymous"), async (calls) => {
      const metadata = await fetchGithubPullRequest(parseGithubPullRequestUrl(canonical));
      assert.equal(metadata.title, "Still anonymous");
      assert.equal(calls.some((call) => call.body?.repositories), false);
      assert.deepEqual(
        calls.filter((call) => call.url.includes("/pulls/")).map((call) => call.authorization),
        [null],
      );
    });
  } finally {
    resetPullRequestGithubAuthCache();
    if (saved.token === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = saved.token;
    if (saved.id === undefined) delete process.env.GITHUB_PR_LINK_APP_ID;
    else process.env.GITHUB_PR_LINK_APP_ID = saved.id;
    if (saved.key === undefined) delete process.env.GITHUB_PR_LINK_APP_PRIVATE_KEY;
    else process.env.GITHUB_PR_LINK_APP_PRIVATE_KEY = saved.key;
  }
});
