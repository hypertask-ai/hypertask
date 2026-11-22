const test = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");
const { loadModule } = require("./helpers/loadModule.cjs");

const parsed = {
  owner: "hypertask-ai", repository: "new-private", number: 7,
  url: "https://github.com/hypertask-ai/new-private/pull/7",
};
const connected = {
  projectId: 15, installationId: "987", repositoryId: "555",
  fullName: "hypertask-ai/new-private",
};

function mappingDb(row = { installationId: connected.installationId, repositoryId: connected.repositoryId }) {
  return {
    boardGithubRepository: {
      findFirst: async (args) => {
        const where = args.where;
        const sameBoard = where.projectId === connected.projectId && where.fullName === connected.fullName;
        const installed = where.provenance === "installed" && where.revokedAt === null;
        return sameBoard && installed && where.installationId && where.repositoryId ? row : null;
      },
    },
  };
}

function authorize() {
  return loadModule("src/lib/pullRequests/boardPullRequestAccess.ts").boardPullRequestAuthorization;
}

test("the switch is a reversible bugfix that ships to everyone", () => {
  const flag = loadModule("src/lib/flags/definitions/htpr-9266-board-private-pull-request-link.ts").default;
  assert.equal(flag.key, "htpr-9266-board-private-pull-request-link");
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.highRisk, undefined);
});

test("only the ticket board's connected repository gets a read token", async () => {
  const minted = [];
  const deps = {
    db: mappingDb(),
    enabled: async () => true,
    installationToken: async (installationId, repositoryId) => {
      minted.push({ installationId, repositoryId });
      return "board-read-token";
    },
  };
  const read = authorize();
  assert.equal(await read(15, parsed, 6, deps), "Bearer board-read-token");
  assert.equal(await read(99, parsed, 6, deps), null);
  assert.equal(await read(15, { ...parsed, repository: "other-private" }, 6, deps), null);
  assert.deepEqual(minted, [{ installationId: "987", repositoryId: "555" }]);
  let attempts = 0;
  const refused = async () => { attempts += 1; throw new Error("installation suspended"); };
  assert.equal(await read(15, parsed, 6, { db: mappingDb(), enabled: async () => false, installationToken: refused }), null);
  assert.equal(attempts, 0);
  assert.equal(await read(15, parsed, 6, { db: mappingDb(), enabled: async () => true, installationToken: refused }), null);
  assert.equal(attempts, 1);
  assert.equal(await read(15, parsed, 6, {
    db: mappingDb({ installationId: null, repositoryId: null }),
    enabled: async () => true,
    installationToken: async () => { throw new Error("must not mint"); },
  }), null);
});

test("a writer receives the board token and a caller who cannot write the ticket does not", async () => {
  const { linkTaskPullRequest, PullRequestLinkError } = loadModule("src/lib/pullRequests/taskPullRequests.ts");
  const lookedUp = [];
  const fetched = [];
  const dbFor = (task) => ({
    task: { findFirst: async () => task },
    taskPullRequest: { findUnique: async () => null },
  });
  const boardAuthorization = async (projectId, url, userId) => {
    lookedUp.push({ projectId, url: url.url, userId });
    return "Bearer board-read-token";
  };
  const denied = linkTaskPullRequest({
    taskId: 9001, userId: 6, url: parsed.url, db: dbFor(null), boardAuthorization,
    fetchMetadata: async () => { throw new Error("must not read GitHub"); },
  });
  await assert.rejects(denied, (error) => error instanceof PullRequestLinkError && error.code === "task_not_found");
  assert.deepEqual(lookedUp, []);
  const allowed = linkTaskPullRequest({
    taskId: 9001, userId: 6, url: parsed.url, db: dbFor({ id: 9001, projectId: 15 }), boardAuthorization,
    fetchMetadata: async (_pullRequest, authorization) => {
      fetched.push(authorization);
      throw new PullRequestLinkError("stop after the read", 404, "pr_not_found");
    },
  });
  await assert.rejects(allowed, (error) => error instanceof PullRequestLinkError && error.code === "pr_not_found");
  assert.deepEqual(lookedUp, [{ projectId: 15, url: parsed.url, userId: 6 }]);
  assert.deepEqual(fetched, ["Bearer board-read-token"]);
});

test("the installation token is read-only for that repository, and a bad id is refused", async () => {
  const { fetchInstallationToken } = loadModule("src/lib/github/appApi.ts");
  const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
  const names = ["GITHUB_APP_ID", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_SLUG", "GITHUB_APP_STATE_SECRET", "GITHUB_APP_PRIVATE_KEY"];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    GITHUB_APP_ID: "424242", GITHUB_APP_CLIENT_ID: "client", GITHUB_APP_CLIENT_SECRET: "secret",
    GITHUB_APP_SLUG: "hypertask", GITHUB_APP_STATE_SECRET: "state-secret-with-enough-length-ok",
    GITHUB_APP_PRIVATE_KEY: pem,
  });
  const calls = [];
  const fetcher = async (url, init) => {
    const body = typeof init?.body === "string" ? init.body : null;
    calls.push(body);
    assert.equal(String(url), "https://api.github.com/app/installations/987/access_tokens");
    if (body !== null) assert.equal(body.includes("PRIVATE KEY"), false);
    return new Response(JSON.stringify({ token: "installation-token" }), { status: 201, headers: { "content-type": "application/json" } });
  };
  try {
    assert.equal(await fetchInstallationToken("987", fetcher, { repositoryId: "555" }), "installation-token");
    assert.equal(await fetchInstallationToken("987", fetcher), "installation-token");
    assert.deepEqual(JSON.parse(calls[0]), {
      repository_ids: [555],
      permissions: { metadata: "read", pull_requests: "read", checks: "read" },
    });
    assert.equal(calls[1], null);
    calls.length = 0;
    for (const repositoryId of ["9007199254740993", "not-a-repo"]) {
      await assert.rejects(
        fetchInstallationToken("987", fetcher, { repositoryId }),
        (error) => error.status === 400,
      );
    }
    assert.equal(calls.length, 0);
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
});
