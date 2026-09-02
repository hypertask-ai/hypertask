const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createHmac } = require("node:crypto");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function loadTs(relativePath) {
  const jiti = require("jiti")(path.join(root, `tests/github-webhook-jiti-entry-${++jitiEntryId}.cjs`), {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  });
  return jiti(path.join(root, relativePath));
}

async function withStubbedGithubRoute(stubbedModules, run) {
  const paths = Object.keys(stubbedModules).map((relativePath) =>
    path.join(root, relativePath)
  );
  const routePath = path.join(root, "src/app/api/webhooks/github/route.ts");
  const previous = new Map(
    [...paths, routePath].map((modulePath) => [
      modulePath,
      require.cache[modulePath],
    ])
  );

  for (const modulePath of [...paths, routePath]) delete require.cache[modulePath];
  for (const [relativePath, exports] of Object.entries(stubbedModules)) {
    const modulePath = path.join(root, relativePath);
    require.cache[modulePath] = {
      id: modulePath,
      filename: modulePath,
      loaded: true,
      exports,
    };
  }

  try {
    return await run(loadTs("src/app/api/webhooks/github/route.ts"));
  } finally {
    for (const [modulePath, cachedModule] of previous) {
      if (cachedModule) require.cache[modulePath] = cachedModule;
      else delete require.cache[modulePath];
    }
  }
}

function mergedPullRequestPayload() {
  return {
    action: "closed",
    repository: {
      id: 123,
      full_name: "hypertask-ai/hypertask",
      private: false,
      fork: false,
    },
    pull_request: {
      id: 456,
      number: 5952,
      title: "HTPR-5952 [BUGFIX] route merges to QA",
      body: null,
      html_url: "https://github.com/hypertask-ai/hypertask/pull/5952",
      merged: true,
      state: "closed",
      updated_at: "2026-09-02T06:00:00.000Z",
      head: { ref: "agent/ht-bug-fixer-htpr-5952", sha: "abc123" },
      base: {
        repo: { id: 123, full_name: "hypertask-ai/hypertask" },
      },
    },
  };
}

function signedGithubRequest(payload, secret) {
  const rawBody = JSON.stringify(payload);
  const signature =
    "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");

  return {
    text: async () => rawBody,
    headers: {
      get: (name) =>
        ({
          "x-hub-signature-256": signature,
          "x-github-event": "pull_request",
        })[name] ?? null,
    },
  };
}

test("verifyGithubSignature accepts a valid signature and rejects everything else", () => {
  const { verifyGithubSignature } = loadTs(
    "src/app/api/webhooks/github/github-webhook-helpers.ts"
  );

  const secret = "github-webhook-test-secret";
  const rawBody = JSON.stringify({ action: "opened", value: 1 });
  const signature =
    "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");

  assert.equal(verifyGithubSignature(rawBody, signature, secret), true);
  assert.equal(verifyGithubSignature(`${rawBody}tampered`, signature, secret), false);
  assert.equal(verifyGithubSignature(rawBody, undefined, secret), false);
  assert.equal(verifyGithubSignature(rawBody, "sha256=too-short", secret), false);
  // Fails closed: no secret configured must never validate, even with a well-formed header.
  assert.equal(verifyGithubSignature(rawBody, signature, undefined), false);
  assert.equal(verifyGithubSignature(rawBody, signature, ""), false);
});

test("the GitHub webhook rejects a configured pull request event without its payload", async () => {
  const stubbedModules = {
    "src/lib/prisma.ts": { default: {} },
    "src/lib/realtime/server.ts": {
      broadcastBoardChange: async () => {},
      broadcastTaskChange: async () => {},
    },
    "src/utils/generateRank.ts": { default: () => "rank" },
    "src/lib/pullRequests/syncTaskPullRequests.ts": {
      syncCheckSuiteFromWebhook: async () => ({ updated: 0, taskIds: [] }),
      syncPullRequestFromWebhook: async () => ({
        linked: 0,
        updated: 0,
        taskIds: [],
      }),
    },
    "src/utils/controllers/comments/createCommentService.ts": {
      createCommentService: async () => {},
    },
    "src/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove.ts": {
      default: async () => {},
    },
    "src/utils/controllers/tasks/single.ts": {
      updateTaskSingle: async () => ({ status: 200 }),
    },
    "src/utils/controllers/assignees/assign.ts": {
      default: async () => ({ status: 200, json: {} }),
    },
  };
  const paths = Object.keys(stubbedModules).map((relativePath) =>
    path.join(root, relativePath),
  );
  const routePath = path.join(root, "src/app/api/webhooks/github/route.ts");
  const previous = new Map(
    [...paths, routePath].map((modulePath) => [
      modulePath,
      require.cache[modulePath],
    ]),
  );
  for (const modulePath of [...paths, routePath]) delete require.cache[modulePath];
  for (const [relativePath, exports] of Object.entries(stubbedModules)) {
    const modulePath = path.join(root, relativePath);
    require.cache[modulePath] = {
      id: modulePath,
      filename: modulePath,
      loaded: true,
      exports,
    };
  }

  const previousSecret = process.env.GITHUB_WEBHOOK_SECRET;
  process.env.GITHUB_WEBHOOK_SECRET = "webhook-test-secret";
  const rawBody = JSON.stringify({
    action: "opened",
    repository: {
      full_name: "hypertask-ai/hypertask",
      private: false,
      fork: false,
    },
  });
  const signature =
    "sha256=" +
    createHmac("sha256", process.env.GITHUB_WEBHOOK_SECRET)
      .update(rawBody, "utf8")
      .digest("hex");

  try {
    const { POST } = loadTs("src/app/api/webhooks/github/route.ts");
    const response = await POST({
      text: async () => rawBody,
      headers: {
        get: (name) =>
          ({
            "x-hub-signature-256": signature,
            "x-github-event": "pull_request",
          })[name] ?? null,
      },
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      success: false,
      error: "Invalid pull request payload",
    });
  } finally {
    if (previousSecret === undefined) delete process.env.GITHUB_WEBHOOK_SECRET;
    else process.env.GITHUB_WEBHOOK_SECRET = previousSecret;
    for (const [modulePath, cachedModule] of previous) {
      if (cachedModule) require.cache[modulePath] = cachedModule;
      else delete require.cache[modulePath];
    }
  }
});

test("merged pull requests move linked tickets to QA in both webhook paths", async (t) => {
  const previousSecret = process.env.GITHUB_WEBHOOK_SECRET;
  const secret = "webhook-test-secret";
  process.env.GITHUB_WEBHOOK_SECRET = secret;

  async function runScenario(
    prisma,
    syncResult,
    moveStatus = 200,
    assignmentResponse = () => ({ status: 200, json: {} }),
    webhookPayload = mergedPullRequestPayload(),
  ) {
    const moves = [];
    const assignmentChanges = [];
    const stubbedModules = {
      "src/lib/prisma.ts": { default: prisma },
      "src/lib/realtime/server.ts": {
        broadcastBoardChange: async () => {},
        broadcastTaskChange: async () => {},
      },
      "src/utils/generateRank.ts": { default: () => "rank" },
      "src/lib/pullRequests/syncTaskPullRequests.ts": {
        syncCheckSuiteFromWebhook: async () => ({ updated: 0, taskIds: [] }),
        syncPullRequestFromWebhook: async () => syncResult,
      },
      "src/utils/controllers/comments/createCommentService.ts": {
        createCommentService: async () => {},
      },
      "src/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove.ts": {
        default: async () => {},
      },
      "src/utils/controllers/tasks/single.ts": {
        updateTaskSingle: async (update) => {
          moves.push(update);
          return { status: moveStatus };
        },
      },
      "src/utils/controllers/assignees/assign.ts": {
        default: async (currentUser, userId, taskId, agentId, agentAssignerId, options) => {
          assignmentChanges.push({
            currentUser,
            userId,
            taskId,
            agentId,
            agentAssignerId,
            options,
          });
          return assignmentResponse({
            currentUser,
            userId,
            taskId,
            agentId,
            agentAssignerId,
            options,
          });
        },
      },
    };

    return withStubbedGithubRoute(stubbedModules, async ({ POST }) => {
      const response = await POST(
        signedGithubRequest(webhookPayload, secret)
      );
      return { response, body: await response.json(), moves, assignmentChanges };
    });
  }

  try {
    await t.test("the first-class synchronization path", async () => {
      const sectionNames = [];
      const prisma = {
        project: {
          findUnique: async () => ({ uniqueIdentifier: "HTPR" }),
        },
        section: {
          findFirst: async ({ where }) => {
            sectionNames.push(where.section_title.equals);
            return {
              id: 5511,
              section_title: "QA",
              autoAssignAgentId: "qa-agent",
            };
          },
          findUnique: async () => ({
            projectId: 15,
            deleted: false,
            section_title: "QA",
            autoAssignAgentId: "qa-agent",
          }),
        },
        task: {
          findMany: async () => [
            {
              id: 36637,
              projectId: 15,
              userId: 6,
              sectionId: 4309,
              riskLevel: "Low",
            },
          ],
          findFirst: async () => null,
          findUnique: async () => ({
            id: 36637,
            projectId: 15,
            sectionId: 5511,
            status: "Normal",
          }),
        },
        assignees: {
          findMany: async () => [
            { userId: 6, agentId: null },
            { userId: 8, agentId: "qa-agent" },
            { userId: 7, agentId: "dev-agent" },
          ],
        },
        user: {
          findUnique: async () => ({
            id: 1,
            email: "bot@example.invalid",
            displayName: "HyperAI",
            photoURL: null,
          }),
        },
      };

      const result = await runScenario(prisma, {
        linked: 1,
        updated: 1,
        taskIds: [36637],
      });

      assert.equal(result.response.status, 200);
      assert.equal(result.body.moved, 1);
      assert.deepEqual(sectionNames, ["QA"]);
      assert.equal(result.moves.length, 1);
      assert.equal(result.moves[0].section, "QA");
      assert.equal(result.moves[0].sectionId, 5511);
      assert.deepEqual(
        result.assignmentChanges.map(({ userId, taskId, agentId, options }) => ({
          userId,
          taskId,
          agentId,
          options,
        })),
        [
          {
            userId: null,
            taskId: 36637,
            agentId: "qa-agent",
            options: {
              intent: "assign",
              expectedProjectId: 15,
              expectedSectionId: 5511,
              allowHumanOverride: false,
            },
          },
          {
            userId: 7,
            taskId: 36637,
            agentId: "dev-agent",
            options: {
              intent: "unassign",
              expectedProjectId: 15,
              expectedSectionId: 5511,
              allowHumanOverride: false,
            },
          },
        ],
      );

      const openedPayload = mergedPullRequestPayload();
      openedPayload.action = "opened";
      openedPayload.pull_request.merged = false;
      openedPayload.pull_request.state = "open";
      const opened = await runScenario(
        prisma,
        { linked: 1, updated: 1, taskIds: [36637] },
        200,
        undefined,
        openedPayload,
      );
      assert.equal(opened.response.status, 200);
      assert.equal(opened.assignmentChanges.length, 0);

      const alreadyQaPrisma = {
        ...prisma,
        task: {
          ...prisma.task,
          findMany: async () => [
            {
              id: 36637,
              projectId: 15,
              userId: 6,
              sectionId: 5511,
              riskLevel: "Low",
            },
          ],
        },
      };
      const repaired = await runScenario(alreadyQaPrisma, {
        linked: 0,
        updated: 0,
        taskIds: [36637],
      });
      assert.equal(repaired.response.status, 200);
      assert.equal(repaired.body.moved, 0);
      assert.equal(repaired.moves.length, 0);
      assert.deepEqual(
        repaired.assignmentChanges.map(({ agentId, options }) => ({
          agentId,
          intent: options.intent,
        })),
        [
          { agentId: "qa-agent", intent: "assign" },
          { agentId: "dev-agent", intent: "unassign" },
        ],
      );

      const noQaAgentPrisma = {
        ...alreadyQaPrisma,
        section: {
          ...alreadyQaPrisma.section,
          findUnique: async () => ({
            projectId: 15,
            deleted: false,
            section_title: "QA",
            autoAssignAgentId: null,
          }),
        },
      };
      const missingQaConfiguration = await runScenario(noQaAgentPrisma, {
        linked: 0,
        updated: 0,
        taskIds: [36637],
      });
      assert.equal(missingQaConfiguration.response.status, 200);
      assert.equal(missingQaConfiguration.assignmentChanges.length, 0);

      const assignmentConflict = await runScenario(
        alreadyQaPrisma,
        { linked: 0, updated: 0, taskIds: [36637] },
        200,
        () => ({ status: 409, json: { message: "Active lease" } }),
      );
      assert.equal(assignmentConflict.response.status, 200);
      assert.deepEqual(
        assignmentConflict.assignmentChanges.map(({ agentId }) => agentId),
        ["qa-agent"],
      );

      const assignmentFailure = await runScenario(
        alreadyQaPrisma,
        { linked: 0, updated: 0, taskIds: [36637] },
        200,
        () => ({ status: 500, json: { message: "Failed" } }),
      );
      assert.equal(assignmentFailure.response.status, 500);
      assert.deepEqual(
        assignmentFailure.assignmentChanges.map(({ agentId }) => agentId),
        ["qa-agent"],
      );

      const deferred = await runScenario(
        prisma,
        { linked: 1, updated: 0, taskIds: [36637] },
        409,
      );
      assert.equal(deferred.response.status, 200);
      assert.equal(deferred.body.linked, 1);
      assert.equal(deferred.body.moved, 0);
      assert.equal(deferred.assignmentChanges.length, 0);
    });

    await t.test("the legacy fallback path", async () => {
      const sectionNames = [];
      let ticketLookup;
      const prisma = {
        project: {
          findUnique: async () => ({ uniqueIdentifier: "HTPR" }),
        },
        section: {
          findFirst: async ({ where }) => {
            sectionNames.push(where.section_title.equals);
            return {
              id: 5511,
              section_title: "QA",
              autoAssignAgentId: "qa-agent",
            };
          },
          findUnique: async () => ({
            projectId: 15,
            deleted: false,
            section_title: "QA",
            autoAssignAgentId: "qa-agent",
          }),
        },
        task: {
          findMany: async () => [],
          findFirst: async ({ where }) =>
            where.ticketNumber
              ? {
                  id: 36637,
                  projectId: 15,
                  userId: 6,
                  sectionId: 4309,
                  uniqueIndex: 5952,
                  ticketNumber: "HTPR-5952",
                  riskLevel: "Low",
                }
              : null,
          findUnique: async () => ({
            id: 36637,
            projectId: 15,
            sectionId: 5511,
            status: "Normal",
          }),
        },
        assignees: {
          findMany: async () => [
            { userId: 6, agentId: null },
            { userId: 8, agentId: "qa-agent" },
            { userId: 7, agentId: "dev-agent" },
          ],
        },
        user: {
          findUnique: async () => ({
            id: 1,
            email: "bot@example.invalid",
            displayName: "HyperAI",
            photoURL: null,
          }),
        },
        comment: { findFirst: async () => null },
      };
      const findTask = prisma.task.findFirst;
      prisma.task.findFirst = async (input) => {
        if (input.where.ticketNumber) ticketLookup = input.where;
        return findTask(input);
      };

      const result = await runScenario(prisma, {
        linked: 0,
        updated: 0,
        taskIds: [],
      });

      assert.equal(result.response.status, 200);
      assert.equal(result.body.moved, true);
      assert.equal(result.body.targetSection, "QA");
      assert.deepEqual(ticketLookup, {
        projectId: 15,
        ticketNumber: "HTPR-5952",
        status: { not: "Deleted" },
      });
      assert.deepEqual(sectionNames, ["QA"]);
      assert.equal(result.moves.length, 1);
      assert.equal(result.moves[0].section, "QA");
      assert.equal(result.moves[0].sectionId, 5511);
      assert.deepEqual(
        result.assignmentChanges.map(({ agentId, options }) => ({
          agentId,
          intent: options.intent,
        })),
        [
          { agentId: "qa-agent", intent: "assign" },
          { agentId: "dev-agent", intent: "unassign" },
        ],
      );

      const deferred = await runScenario(
        prisma,
        { linked: 0, updated: 0, taskIds: [] },
        409,
      );
      assert.equal(deferred.response.status, 200);
      assert.equal(deferred.body.commented, true);
      assert.equal(deferred.body.moved, false);
      assert.equal(deferred.assignmentChanges.length, 0);
    });
  } finally {
    if (previousSecret === undefined) delete process.env.GITHUB_WEBHOOK_SECRET;
    else process.env.GITHUB_WEBHOOK_SECRET = previousSecret;
  }
});

test("extractTicketId checks branch, then title, then body, in that order", () => {
  const { extractTicketId } = loadTs(
    "src/app/api/webhooks/github/github-webhook-helpers.ts"
  );

  assert.equal(
    extractTicketId({
      boardPrefix: "INNE",
      title: "Improve GitHub integration",
      headRef: "feat/INNE-22-webhook",
      body: "Resolves PROD-8",
    }),
    "INNE-22"
  );
  assert.equal(
    extractTicketId({
      boardPrefix: "HTPR",
      title: "Ship HTPR-4437",
      headRef: "feat/github-webhook",
      body: "Resolves PROD-8",
    }),
    "HTPR-4437"
  );
  assert.equal(
    extractTicketId({
      boardPrefix: "PROD",
      title: "Improve GitHub integration",
      headRef: "feat/github-webhook",
      body: "Resolves PROD-8",
    }),
    "PROD-8"
  );
  assert.equal(
    extractTicketId({
      boardPrefix: "HTPR",
      headRef: "htpr-4437-github-pr-link",
    }),
    "HTPR-4437"
  );
  assert.equal(
    extractTicketId({
      boardPrefix: "HTPR",
      title: "Improve GitHub integration",
      headRef: "feat/github-webhook",
      body: "No ticket reference here",
    }),
    null
  );
});

test("extractTicketId skips agent slugs and finds the linked board ticket", () => {
  const { extractTicketId } = loadTs(
    "src/app/api/webhooks/github/github-webhook-helpers.ts"
  );

  assert.equal(
    extractTicketId({
      boardPrefix: "HTPR",
      headRef: "agent/dev-3-htpr-5923-qa-regressions",
    }),
    "HTPR-5923"
  );
  assert.equal(
    extractTicketId({
      boardPrefix: "HTPR",
      headRef: "agent/ht-bug-fixer-htpr-5952",
    }),
    "HTPR-5952"
  );
});

test("extractTicketId prefers the branch's ticket over a different ticket mentioned in the title", () => {
  const { extractTicketId } = loadTs(
    "src/app/api/webhooks/github/github-webhook-helpers.ts"
  );

  // Title references a stale/related ticket; branch is the PR's own ticket.
  // Trusting the title here would silently act on the wrong (possibly
  // cross-board) ticket.
  assert.equal(
    extractTicketId({
      boardPrefix: "INNE",
      title: "Revert HTPR-1234, follow-up to INNE-99",
      headRef: "inne-22-branch",
      body: "supersedes HTPR-4400",
    }),
    "INNE-22"
  );
});

test("extractTicketId is not hijacked by ticket-shaped technical prose in the title", () => {
  const { extractTicketId } = loadTs(
    "src/app/api/webhooks/github/github-webhook-helpers.ts"
  );

  // "UTF-8" / "SHA-256" match the WORD-123 shape but are not ticket ids.
  // Branch-first precedence means the real ticket wins before the title is
  // even inspected.
  assert.equal(
    extractTicketId({
      boardPrefix: "HTPR",
      title: "Use UTF-8 encoding consistently, hash with SHA-256",
      headRef: "htpr-4437-github-pr-link",
      body: "",
    }),
    "HTPR-4437"
  );
});
