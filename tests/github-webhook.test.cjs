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
  const paths = [...new Set([
    ...Object.keys(stubbedModules),
    "src/utils/controllers/assignees/assign.ts",
    "src/utils/controllers/agents/boardMembers.ts",
    "src/lib/agents/visibility.ts",
  ])].map((relativePath) => path.join(root, relativePath));
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

  async function runScenario(prisma, syncResult, moveStatus = 200) {
    const moves = [];
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
        default: async () => ({ status: 200, json: {} }),
      },
    };

    return withStubbedGithubRoute(stubbedModules, async ({ POST }) => {
      const response = await POST(
        signedGithubRequest(mergedPullRequestPayload(), secret)
      );
      return { response, body: await response.json(), moves };
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
            return { id: 5511, section_title: "QA" };
          },
          findUnique: async () => ({
            id: 5511,
            projectId: 15,
            deleted: false,
            section_title: "QA",
            autoAssignAgentId: null,
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
            projectId: 15,
            sectionId: 5511,
            status: "Normal",
          }),
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

      const deferred = await runScenario(
        prisma,
        { linked: 1, updated: 0, taskIds: [36637] },
        409,
      );
      assert.equal(deferred.response.status, 200);
      assert.equal(deferred.body.linked, 1);
      assert.equal(deferred.body.moved, 0);
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
            return { id: 5511, section_title: "QA" };
          },
          findUnique: async () => ({
            id: 5511,
            projectId: 15,
            deleted: false,
            section_title: "QA",
            autoAssignAgentId: null,
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
            projectId: 15,
            sectionId: 5511,
            status: "Normal",
          }),
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

      const deferred = await runScenario(
        prisma,
        { linked: 0, updated: 0, taskIds: [] },
        409,
      );
      assert.equal(deferred.response.status, 200);
      assert.equal(deferred.body.commented, true);
      assert.equal(deferred.body.moved, false);
    });
  } finally {
    if (previousSecret === undefined) delete process.env.GITHUB_WEBHOOK_SECRET;
    else process.env.GITHUB_WEBHOOK_SECRET = previousSecret;
  }
});

test("merged pull requests reconcile QA and developer agent assignments", async (t) => {
  const previousSecret = process.env.GITHUB_WEBHOOK_SECRET;
  const secret = "webhook-test-secret";
  process.env.GITHUB_WEBHOOK_SECRET = secret;

  async function runScenario({
    legacy = false,
    startingSectionId = 4309,
    moveStatus = 200,
    qaAgentId = "qa-agent",
    assignmentResponse = () => ({ status: 200, json: {} }),
    useRealAssignment = false,
    readFailure = null,
    taskOverrides = {},
    existingAssignees = [
      { userId: 6, agentId: null },
      { userId: 8, agentId: "qa-agent" },
      { userId: 7, agentId: "dev-agent" },
    ],
    readAssignees = async () => existingAssignees,
    payload = mergedPullRequestPayload(),
  } = {}) {
    const moves = [];
    const assignmentChanges = [];
    const warnings = [];
    let currentSectionId = startingSectionId;
    let actorReads = 0;
    const taskEvents = [];
    const task = {
      id: 36637,
      projectId: 15,
      userId: 6,
      sectionId: startingSectionId,
      uniqueIndex: 5952,
      ticketNumber: "HTPR-5952",
      riskLevel: "Low",
      ...taskOverrides,
    };
    const prisma = {
      project: {
        findUnique: async () => ({ uniqueIdentifier: "HTPR" }),
      },
      section: {
        findFirst: async () => ({ id: 5511, section_title: "QA" }),
        findUnique: async () => {
          if (readFailure === "section") throw new Error("QA section read failed");
          return {
            id: currentSectionId,
            projectId: 15,
            deleted: false,
            section_title: currentSectionId === 5511 ? "QA" : "In Progress",
            autoAssignAgentId: currentSectionId === 5511 ? qaAgentId : null,
          };
        },
      },
      task: {
        findMany: async () => (legacy ? [] : [task]),
        findFirst: async ({ where }) => (where.ticketNumber ? task : null),
        findUnique: async () => {
          if (readFailure === "task") throw new Error("QA task read failed");
          return { ...task, sectionId: currentSectionId, status: "Normal" };
        },
      },
      assignees: { findMany: readAssignees },
      agent: {
        findFirst: async ({ where }) => {
          assert.equal(where.id, qaAgentId);
          assert.equal(where.revokedAt, null);
          assert.deepEqual(where.OR, [{ userId: 332 }, { visibility: "TEAM" }]);
          return null;
        },
      },
      member: {
        findFirst: async ({ where }) => {
          assert.deepEqual(where, {
            projectId: 15,
            agentId: qaAgentId,
            agent: { revokedAt: null },
          });
          return null;
        },
      },
      user: {
        findUnique: async () => {
          actorReads += 1;
          if (readFailure === "actor" && actorReads > 1) throw new Error("QA actor read failed");
          return {
            id: 332,
            email: "bot@example.invalid",
            displayName: "HyperAI",
            photoURL: null,
          };
        },
      },
      comment: { findFirst: async () => null },
    };
    const syncResult = legacy
      ? { linked: 0, updated: 0, taskIds: [] }
      : { linked: 1, updated: 1, taskIds: [task.id] };
    const stubbedModules = {
      "src/lib/prisma.ts": { default: prisma },
      "src/lib/realtime/server.ts": {
        broadcastBoardChange: async () => {},
        broadcastTaskChange: async (taskId) => taskEvents.push(taskId),
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
          if (moveStatus === 200) currentSectionId = update.sectionId;
          return { status: moveStatus };
        },
      },
      "src/utils/controllers/assignees/assign.ts": {
        default: async (currentUser, userId, taskId, agentId, agentAssignerId, options) => {
          const change = {
            currentUser,
            userId,
            taskId,
            agentId,
            agentAssignerId,
            options,
          };
          assignmentChanges.push(change);
          return assignmentResponse(change);
        },
      },
    };

    if (useRealAssignment) {
      delete stubbedModules["src/utils/controllers/assignees/assign.ts"];
      Object.assign(stubbedModules, {
        "src/utils/controllers/FCM/index.ts": {},
        "src/utils/controllers/activities/createAssignedActivity.ts": {},
        "src/utils/controllers/notifications/creation-service/check-reminder_create-notification.ts": {},
        "src/utils/controllers/notifications/agentActionRecipients.ts": {},
        "src/utils/controllers/notifications/sendAssignEmail.ts": {},
        "src/utils/index.ts": { taskBaseUri: "https://app.hypertask.ai/detail/" },
        "src/lib/mcp/tasks/services.ts": {},
        "src/lib/agentWebhooks/outbox.ts": {},
        "src/lib/mcp/webhooks/outbox.ts": {},
        "src/lib/mcp/tasks/agentMutationFence.ts": {
          AgentMutationLeaseConflictError: class extends Error {},
        },
      });
    }

    const previousWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
    try {
      return await withStubbedGithubRoute(stubbedModules, async ({ POST }) => {
        if (useRealAssignment) {
          const { default: assigneesAssign } = loadTs("src/utils/controllers/assignees/assign.ts");
          const assignment = await assigneesAssign(
            { id: 332 }, null, task.id, qaAgentId, undefined,
            { expectedProjectId: 15, expectedSectionId: 5511, allowHumanOverride: false, intent: "assign" },
          );
          assert.equal(assignment.status, 400);
          assert.equal(assignment.json.message,
            "Agent is not a member of this board. Add the agent to the board before assigning.");
        }
        const response = await POST(signedGithubRequest(payload, secret));
        return {
          response, body: await response.json(), moves, assignmentChanges,
          warnings, currentSectionId, existingAssignees, taskEvents,
        };
      });
    } finally {
      console.warn = previousWarn;
    }
  }

  try {
    for (const legacy of [false, true]) {
      await t.test(legacy ? "legacy path" : "linked path", async () => {
        const result = await runScenario({ legacy });
        assert.equal(result.response.status, 200);
        assert.deepEqual(
          result.assignmentChanges.map(({ userId, agentId, options }) => ({
            userId,
            agentId,
            options,
          })),
          [
            {
              userId: null,
              agentId: "qa-agent",
              options: {
                expectedProjectId: 15,
                expectedSectionId: 5511,
                allowHumanOverride: false,
                intent: "assign",
              },
            },
            {
              userId: 7,
              agentId: "dev-agent",
              options: {
                expectedProjectId: 15,
                expectedSectionId: 5511,
                allowHumanOverride: false,
                intent: "unassign",
              },
            },
          ],
        );
      });
    }

    await t.test("already-QA delivery repairs assignments", async () => {
      const result = await runScenario({ startingSectionId: 5511 });
      assert.equal(result.response.status, 200);
      assert.equal(result.moves.length, 0);
      assert.deepEqual(
        result.assignmentChanges.map(({ agentId }) => agentId),
        ["qa-agent", "dev-agent"],
      );
    });

    await t.test("lease conflicts preserve existing agents", async () => {
      const result = await runScenario({
        startingSectionId: 5511,
        assignmentResponse: () => ({
          status: 409,
          json: { message: "Active lease" },
        }),
      });
      assert.equal(result.response.status, 200);
      assert.deepEqual(
        result.assignmentChanges.map(({ agentId }) => agentId),
        ["qa-agent"],
      );
    });

    await t.test("missing QA configuration preserves existing agents", async () => {
      const result = await runScenario({
        startingSectionId: 5511,
        qaAgentId: null,
      });
      assert.equal(result.response.status, 200);
      assert.equal(result.assignmentChanges.length, 0);
    });

    for (const legacy of [false, true]) {
      await t.test(`stale board 15 QA auto-assignee preserves the moved ticket (${legacy ? "legacy" : "linked"})`, async () => {
        const payload = mergedPullRequestPayload();
        payload.pull_request.number = 1193;
        payload.pull_request.title = "HTPR-7014 [BUGFIX] merge delivery";
        payload.pull_request.html_url = "https://github.com/hypertask-ai/hypertask/pull/1193";
        payload.pull_request.head.ref = "htpr-7014-fix";
        const existingAssignees = [
          { userId: 6, agentId: "32323d91-41e2-43c4-9370-ea7c0110d1b0" },
        ];
        const result = await runScenario({
          legacy, payload, useRealAssignment: true,
          startingSectionId: 4310,
          qaAgentId: "b7ad06ff-1aaa-4a64-937d-f7fd801506e5",
          taskOverrides: { id: 57334, uniqueIndex: 7014, ticketNumber: "HTPR-7014" },
          existingAssignees,
        });
        assert.equal(result.moves.length, 1);
        assert.equal(result.currentSectionId, 5511);
        assert.deepEqual(result.existingAssignees, existingAssignees);
        assert.equal(result.response.status, 200);
        assert.equal(result.body.success, true);
        assert.match(result.warnings.flat().join(" "), /Task 57334.*400.*Agent is not a member of this board/);
      });

      for (const status of [400, 403, 404, 409, 500]) {
        await t.test(`QA assignment status ${status} is optional (${legacy ? "legacy" : "linked"})`, async () => {
          const result = await runScenario({
            legacy,
            assignmentResponse: () => ({ status, json: { message: "Assignment rejected" } }),
          });
          assert.equal(result.currentSectionId, 5511);
          assert.equal(result.response.status, 200);
          assert.equal(result.assignmentChanges.length, 1);
          assert.match(result.warnings.flat().join(" "), new RegExp(`Task 36637.*${status}.*Assignment rejected`));
        });
      }

      for (const status of [400, 409, 500]) {
        await t.test(`outgoing agent status ${status} is optional (${legacy ? "legacy" : "linked"})`, async () => {
          const result = await runScenario({
            legacy,
            startingSectionId: 5511,
            assignmentResponse: ({ options }) => options.intent === "assign"
              ? { status: 200, json: { assignmentOutcome: "created" } }
              : { status, json: { message: "Removal rejected" } },
          });
          assert.equal(result.response.status, 200);
          assert.equal(result.assignmentChanges.length, 2);
          assert.deepEqual(result.taskEvents, [36637]);
          assert.match(result.warnings.flat().join(" "), new RegExp(`Task 36637.*${status}.*Removal rejected`));
        });
      }

      for (const phase of ["assign", "unassign", "read-assignees"]) {
        await t.test(`QA cleanup ${phase} exception is optional (${legacy ? "legacy" : "linked"})`, async () => {
          const result = await runScenario({
            legacy,
            startingSectionId: phase === "assign" ? 4309 : 5511,
            assignmentResponse: ({ options }) => {
              if (options.intent === phase) throw new Error("Assignment service unavailable");
              return { status: 200, json: { assignmentOutcome: "created" } };
            },
            ...(phase === "read-assignees" ? {
              readAssignees: async () => { throw new Error("Assignment service unavailable"); },
            } : {}),
          });
          assert.equal(result.response.status, 200);
          assert.equal(result.currentSectionId, 5511);
          assert.match(result.warnings.flat().join(" "), /Task 36637.*exception.*Assignment service unavailable/);
          assert.deepEqual(result.taskEvents, [36637]);
        });
      }

      for (const readFailure of ["task", "section", "actor"]) {
        await t.test(`QA ${readFailure} lookup failure is optional (${legacy ? "legacy" : "linked"})`, async () => {
          const result = await runScenario({ legacy, readFailure });
          assert.equal(result.moves.length, 1);
          assert.equal(result.currentSectionId, 5511);
          assert.equal(result.response.status, 200);
          assert.match(result.warnings.flat().join(" "), new RegExp(`Task 36637.*exception.*QA ${readFailure} read failed`));
        });
      }

      await t.test(`real move failures still fail the delivery (${legacy ? "legacy" : "linked"})`, async () => {
        const result = await runScenario({ legacy, moveStatus: 500 });
        assert.equal(result.response.status, 500);
        assert.equal(result.currentSectionId, 4309);
        assert.equal(result.assignmentChanges.length, 0);
        assert.deepEqual(result.body, { success: false, error: "Internal server error" });
      });
    }

    await t.test("non-merge events do not reconcile assignments", async () => {
      const payload = mergedPullRequestPayload();
      payload.action = "opened";
      payload.pull_request.merged = false;
      payload.pull_request.state = "open";
      const result = await runScenario({ payload });
      assert.equal(result.response.status, 200);
      assert.equal(result.assignmentChanges.length, 0);
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

test("extractTicketId ignores flag keys in the body of another board's PR (PR 1191 moved HTPR-7010)", () => {
  const { extractTicketId } = loadTs(
    "src/app/api/webhooks/github/github-webhook-helpers.ts"
  );

  // HTPR-7014: PR 1191 belonged to YPER4-220, but its description mentioned
  // the flag "htpr-7010", so merging it moved HTPR-7010 to QA.
  assert.equal(
    extractTicketId({
      boardPrefix: "HTPR",
      title: "YPER4-220 [INFRA] One AI model per class, enforced by a test",
      headRef: "yper4-220-model-class",
      body: "Covers the htpr-7010 and htpr-6722 flag combinations, flag htpr-7010-haiku-5-5. Fixes HTPR-7010.",
    }),
    null
  );
  assert.equal(
    extractTicketId({
      boardPrefix: "HTPR",
      title: "Improve GitHub integration",
      headRef: "feat/github-webhook",
      body: "Flag htpr-7010-haiku-5-5 and HTPR-7010-haiku stay off; the htpr-7010 flag too.",
    }),
    null
  );
  assert.equal(
    extractTicketId({
      boardPrefix: "HTPR",
      title: "Improve GitHub integration",
      headRef: "feat/github-webhook",
      body: "Resolves HTPR-7014.",
    }),
    "HTPR-7014"
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
