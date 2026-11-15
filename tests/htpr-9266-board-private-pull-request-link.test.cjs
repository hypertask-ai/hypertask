const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/loadModule.cjs");

const parsed = {
  owner: "hypertask-ai",
  repository: "hypertask-private",
  number: 42,
  url: "https://github.com/hypertask-ai/hypertask-private/pull/42",
};

function mappingDb(rows) {
  const calls = [];
  return {
    calls,
    db: {
      boardGithubRepository: {
        findFirst: async (args) => {
          calls.push(args);
          return rows;
        },
      },
    },
  };
}

function resolver() {
  return loadModule("src/lib/pullRequests/boardPullRequestAccess.ts")
    .boardPullRequestAuthorization;
}

test("boardPullRequestAuthorization uses the board installation token for a connected private repository", async () => {
  const { db, calls } = mappingDb({ installationId: "987" });
  const minted = [];
  const authorization = await resolver()(15, parsed, 6, {
    db,
    enabled: async () => true,
    installationToken: async (installationId) => {
      minted.push(installationId);
      return "board-read-token";
    },
  });
  assert.equal(authorization, "Bearer board-read-token");
  assert.deepEqual(minted, ["987"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].where.projectId, 15);
  assert.equal(calls[0].where.fullName, "hypertask-ai/hypertask-private");
  assert.equal(calls[0].where.provenance, "installed");
  assert.equal(calls[0].where.revokedAt, null);
});

test("boardPullRequestAuthorization mints nothing when the switch is off", async () => {
  const { db, calls } = mappingDb({ installationId: "987" });
  let minted = 0;
  const authorization = await resolver()(15, parsed, 6, {
    db,
    enabled: async () => false,
    installationToken: async () => {
      minted += 1;
      return "board-read-token";
    },
  });
  assert.equal(authorization, null);
  assert.equal(minted, 0);
  assert.equal(calls.length, 0);
});

test("boardPullRequestAuthorization stays anonymous without a board installation or a usable token", async () => {
  const unconnected = mappingDb({ installationId: null });
  const refused = mappingDb({ installationId: "987" });
  assert.equal(
    await resolver()(15, parsed, 6, {
      db: unconnected.db,
      enabled: async () => true,
      installationToken: async () => {
        throw new Error("must not mint without an installation");
      },
    }),
    null,
  );
  assert.equal(
    await resolver()(15, parsed, 6, {
      db: refused.db,
      enabled: async () => true,
      installationToken: async () => {
        throw new Error("installation suspended");
      },
    }),
    null,
  );
});

function handler(stub) {
  return loadModule("src/lib/mcp/tasks/fields/pullRequest.ts", {
    "@/lib/pullRequests/boardPullRequestAccess": {
      boardPullRequestAuthorization: stub,
    },
  }).updateTaskPullRequest;
}

function context(linkCalls, agentId = null) {
  return {
    parsedPullRequest: parsed,
    user: { id: 6 },
    ctx: { agentId, teamScope: null },
    linkPullRequest: async (input) => {
      linkCalls.push(input);
    },
  };
}

const target = { id: 9001, sectionId: 10, projectId: 15, status: "Normal" };
const linkedUrl = "https://github.com/hypertask-ai/hypertask-private/pull/42";

test("a pull request update links with the board token for the ticket's own board", async () => {
  const linkCalls = [];
  await handler(async (projectId, url, userId) => {
    assert.equal(projectId, 15);
    assert.equal(url, parsed);
    assert.equal(userId, 6);
    return "Bearer board-read-token";
  })(context(linkCalls), target);
  assert.deepEqual(linkCalls, [{
    taskId: 9001,
    userId: 6,
    agentId: null,
    teamScope: null,
    url: linkedUrl,
    authorization: "Bearer board-read-token",
  }]);
});

test("a pull request update without a board connection keeps the existing anonymous link", async () => {
  const linkCalls = [];
  await handler(async () => null)(context(linkCalls, "agent-1"), target);
  assert.deepEqual(linkCalls, [{
    taskId: 9001,
    userId: 6,
    agentId: "agent-1",
    teamScope: null,
    url: linkedUrl,
  }]);
});
