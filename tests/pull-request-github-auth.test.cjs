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
const {
  fetchGithubPullRequest,
  PullRequestLinkError,
} = jiti(path.join(root, "src/lib/pullRequests/taskPullRequests.ts"));
const {
  PULL_REQUEST_LINK_READ_PERMISSIONS,
  resetPullRequestGithubAuthCache,
} = jiti(path.join(root, "src/lib/pullRequests/githubLinkAuth.ts"));

const canonicalPullRequestUrl = "https://github.com/hypertask-ai/hypertask/pull/110";
const foreignPullRequestUrl = "https://github.com/nodejs/node/pull/1";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" });

function pullJson(url, id, title) {
  return {
    id,
    html_url: url,
    title,
    state: "open",
    merged_at: null,
    updated_at: "2026-11-11T00:00:00Z",
    base: { repo: { id: id } },
    head: { sha: "abc123" },
  };
}

function checkRuns() {
  return Response.json({
    total_count: 1,
    check_runs: [{ status: "completed", conclusion: "success" }],
  });
}

function installationResponse() {
  return Response.json([{ id: 77, suspended_at: null, account: { login: "hypertask-ai" } }]);
}

function tokenResponse(token) {
  return Response.json(
    { token, expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
    { status: 201 },
  );
}

function repositoryPage(repositories) {
  return Response.json({ total_count: repositories.length, repositories });
}

async function withFetch(mock, callback) {
  const originalFetch = global.fetch;
  global.fetch = mock;
  try {
    await callback();
  } finally {
    global.fetch = originalFetch;
  }
}

test("fetchGithubPullRequest uses a read-only token for public installation repositories", async () => {
  const previousToken = process.env.GITHUB_TOKEN;
  const previousAppId = process.env.GITHUB_PR_LINK_APP_ID;
  const previousAppKey = process.env.GITHUB_PR_LINK_APP_PRIVATE_KEY;
  delete process.env.GITHUB_TOKEN;
  process.env.GITHUB_PR_LINK_APP_ID = "424242";
  process.env.GITHUB_PR_LINK_APP_PRIVATE_KEY = pem;
  resetPullRequestGithubAuthCache();
  const calls = [];
  const record = async (url, init) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    const authorization = init?.headers?.Authorization ?? null;
    calls.push({ url: String(url), authorization, body });
    assert.equal(String(url).startsWith("https://api.github.com/"), true);
    if (authorization) assert.equal(String(authorization).includes(pem), false);
    if (authorization) assert.equal(String(authorization).includes("PRIVATE KEY"), false);
    if (body) assert.equal(JSON.stringify(body).includes("PRIVATE KEY"), false);
    return { url: String(url), authorization, body };
  };

  try {
    await withFetch(async (url, init) => {
      const call = await record(url, init);
      if (call.url.endsWith("/app/installations")) return installationResponse();
      if (call.url.includes("/access_tokens") && call.body?.repositories) {
        return tokenResponse("read-token");
      }
      if (call.url.includes("/access_tokens")) return tokenResponse("list-token");
      if (call.url.includes("/installation/repositories")) {
        return repositoryPage([
          { name: "hypertask", private: false },
          { name: "secret", private: true },
          { name: "unmarked" },
        ]);
      }
      if (call.url.includes("/check-runs")) return checkRuns();
      if (call.url.includes("/nodejs/node/")) {
        return Response.json(pullJson(foreignPullRequestUrl, 1, "Foreign public"));
      }
      return Response.json(pullJson(canonicalPullRequestUrl, 110, "Linked property"));
    }, async () => {
      const metadata = await fetchGithubPullRequest(
        parseGithubPullRequestUrl(canonicalPullRequestUrl),
      );
      assert.equal(metadata.title, "Linked property");
      const foreign = await fetchGithubPullRequest(
        parseGithubPullRequestUrl(foreignPullRequestUrl),
      );
      assert.equal(foreign.title, "Foreign public");
    });

    const narrow = calls.filter((call) => call.body?.repositories);
    assert.equal(narrow.length, 1);
    assert.deepEqual(narrow[0].body.permissions, PULL_REQUEST_LINK_READ_PERMISSIONS);
    assert.deepEqual(narrow[0].body.repositories, ["hypertask"]);
    assert.equal(JSON.stringify(narrow[0].body).includes("write"), false);
    const pullCalls = calls.filter((call) => call.url.includes("/pulls/"));
    assert.deepEqual(
      pullCalls.map((call) => call.authorization),
      ["Bearer read-token", "Bearer read-token"],
    );
    assert.equal(calls.some((call) => call.authorization === "Bearer list-token" && call.url.includes("/pulls/")), false);

    calls.length = 0;
    resetPullRequestGithubAuthCache();
    await withFetch(async (url, init) => {
      const call = await record(url, init);
      if (call.url.endsWith("/app/installations")) return installationResponse();
      if (call.url.includes("/access_tokens") && call.body?.repositories) {
        return tokenResponse("read-token");
      }
      if (call.url.includes("/access_tokens")) return tokenResponse("list-token");
      if (call.url.includes("/installation/repositories")) {
        return repositoryPage([{ name: "hypertask", private: false }]);
      }
      if (call.url.includes("/check-runs")) return checkRuns();
      if (call.authorization) {
        return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      }
      return Response.json(pullJson(canonicalPullRequestUrl, 110, "Anonymous public"));
    }, async () => {
      const metadata = await fetchGithubPullRequest(
        parseGithubPullRequestUrl(canonicalPullRequestUrl),
      );
      assert.equal(metadata.title, "Anonymous public");
    });
    const fallbackPulls = calls.filter((call) => call.url.includes("/pulls/110"));
    assert.deepEqual(
      fallbackPulls.map((call) => call.authorization),
      ["Bearer read-token", null],
    );

    calls.length = 0;
    resetPullRequestGithubAuthCache();
    process.env.GITHUB_TOKEN = "scoped-token";
    await withFetch(async (url, init) => {
      await record(url, init);
      return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    }, async () => {
      await assert.rejects(
        fetchGithubPullRequest(parseGithubPullRequestUrl(canonicalPullRequestUrl)),
        (error) => error instanceof PullRequestLinkError && error.code === "pr_not_found",
      );
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].authorization, "Bearer scoped-token");
    assert.equal(calls.some((call) => call.url.includes("/app/")), false);

    delete process.env.GITHUB_TOKEN;
    process.env.GITHUB_PR_LINK_APP_ID = "424243";
    calls.length = 0;
    resetPullRequestGithubAuthCache();
    await withFetch(async (url, init) => {
      const call = await record(url, init);
      if (call.url.endsWith("/app/installations")) return installationResponse();
      if (call.url.includes("/access_tokens")) return tokenResponse("list-token");
      if (call.url.includes("/installation/repositories")) {
        return repositoryPage([{ name: "secret", private: true }]);
      }
      if (call.url.includes("/check-runs")) return checkRuns();
      return Response.json(pullJson(canonicalPullRequestUrl, 110, "Still anonymous"));
    }, async () => {
      const metadata = await fetchGithubPullRequest(
        parseGithubPullRequestUrl(canonicalPullRequestUrl),
      );
      assert.equal(metadata.title, "Still anonymous");
    });
    assert.equal(calls.some((call) => call.body?.repositories), false);
    const anonymousPulls = calls.filter((call) => call.url.includes("/pulls/110"));
    assert.deepEqual(anonymousPulls.map((call) => call.authorization), [null]);
  } finally {
    resetPullRequestGithubAuthCache();
    if (previousToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previousToken;
    if (previousAppId === undefined) delete process.env.GITHUB_PR_LINK_APP_ID;
    else process.env.GITHUB_PR_LINK_APP_ID = previousAppId;
    if (previousAppKey === undefined) delete process.env.GITHUB_PR_LINK_APP_PRIVATE_KEY;
    else process.env.GITHUB_PR_LINK_APP_PRIVATE_KEY = previousAppKey;
  }
});
