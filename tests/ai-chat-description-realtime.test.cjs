const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const route = ts.createSourceFile(
  "route.ts",
  fs.readFileSync(path.join(root, "src/app/api/ai/chat/stream/route.ts"), "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const bulkTools = jiti(path.join(root, "src/app/api/ai/chat/stream/bulkTools.ts"));
const { toStoredHtml } = jiti(path.join(root, "src/utils/helperFunctions/toStoredHtml.ts"));
const {
  mergeRealtimeTaskDetail,
  shouldRefetchTaskDetail,
  shouldSyncTaskDetailContent,
} = jiti(path.join(root, "src/lib/realtime/taskDetailRefresh.ts"));
const { TASK_EVENT } = jiti(path.join(root, "src/lib/realtime/shared.ts"));

function findNode(predicate) {
  let found;
  function visit(node) {
    if (predicate(node)) found = node;
    else ts.forEachChild(node, visit);
  }
  visit(route);
  assert.ok(found, "production handler must exist");
  return found;
}

// Execute the route's actual tool closure without loading unrelated chat providers.
function loadExecute(toolName, dependencies) {
  const tool = findNode((node) =>
    ts.isPropertyAssignment(node) && node.name.getText(route) === toolName,
  );
  const execute = tool.initializer.arguments[0].properties.find(
    (node) => node.name?.getText(route) === "execute",
  );
  const helpers = [
    "withToolErrors", "dropEmptyPadding", "buildActivityUser",
    "userHasProjectAccess", "findDraftWithAccess",
  ].map((name) => findNode((node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === name,
  ).getText(route));
  const javascript = ts.transpileModule(
    `${helpers.join("\n")}\nconst execute = ${execute.initializer.getText(route)};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } },
  ).outputText;
  return new Function(...Object.keys(dependencies), `${javascript}\nreturn execute;`)(
    ...Object.values(dependencies),
  );
}

const USER_ID = 7;
const TASK_ID = 42;
const PROJECT_ID = 15;
const content = "<h2>Goal</h2><p>Original line</p><p>Added by AI</p>";

function fixture(overrides = {}) {
  const calls = [];
  const task = {
    id: TASK_ID,
    projectId: PROJECT_ID,
    uniqueIndex: 6633,
    section: "Bugs",
    sectionId: 1,
    status: "Normal",
    dueDate: null,
    description_: { content: "<p>Original line</p>", attachments: [] },
  };
  const draft = {
    id: 100,
    taskId: TASK_ID,
    projectId: PROJECT_ID,
    userId: USER_ID,
    type: "Description",
    content,
    task: { ticketNumber: "HTPR-6633", project: { ownerId: USER_ID } },
  };
  const save = async (html) => {
    calls.push(["save", html]);
    task.description_.content = html;
  };
  const dependencies = {
    ...bulkTools,
    toStoredHtml,
    user: { id: USER_ID },
    actingAgentId: null,
    sendStatus() {},
    errorMessage: (error) => error.message,
    sanitizeForJson: (value) => value,
    resolveTaskForTool: async () => ({ task }),
    validateProjectAccess: async () => ({}),
    taskDetailInclude: () => ({}),
    mapTaskToDetail: (value) => value,
    buildMcpTaskUrl: () => "/detail/project-15/6633",
    prisma: {
      user: { findUnique: async () => ({ id: USER_ID, displayName: "Member" }) },
      task: { findUnique: async () => task },
      drafts: { findUnique: async () => draft },
      docVersion: {
        findFirst: async () => ({ contentHtml: content, version: 2 }),
        findMany: async () => [],
      },
    },
    updateTaskSingle: async (patch) => {
      await save(patch.description);
      return { status: 200, json: task };
    },
    upsertTaskDescription: async (input) => save(input.content),
    persistUrlsForDescription: async () => {},
    broadcastBoardChange: async (...args) => calls.push(["board", ...args]),
    broadcastTaskChange: async (...args) => calls.push(["task", ...args]),
    ...overrides,
  };
  return { calls, task, draft, dependencies };
}

const cases = [
  ["ordinary AI description edit", "hypertask_update_task", { task_id: TASK_ID, description: content }],
  ["AI description draft publication", "hypertask_draft", { action: "publish", draft_id: 100 }],
  ["AI description version restoration", "hypertask_task_description_history", { action: "restore", task_id: TASK_ID, version_id: 200 }],
];

for (const [name, toolName, input] of cases) {
  test(`${name} notifies both the board and the open task after saving`, async () => {
    const { calls, task, dependencies } = fixture();
    const result = await loadExecute(toolName, dependencies)(input);
    assert.equal(result.success, true);
    assert.deepEqual(calls, [
      ["save", content],
      ["board", PROJECT_ID, { originUserId: USER_ID }],
      ["task", TASK_ID, { originUserId: USER_ID }],
    ]);

    assert.equal(shouldRefetchTaskDetail({
      event: TASK_EVENT, currentUserId: USER_ID, originUserId: USER_ID,
    }), true);
    const current = { ...task, description_: { content: "<p>Original line</p>" } };
    const refreshed = mergeRealtimeTaskDetail(
      current, task, shouldSyncTaskDetailContent(TASK_EVENT, false),
    );
    assert.equal(refreshed.description_.content, content);
    const protectedDraft = mergeRealtimeTaskDetail(
      current, task, shouldSyncTaskDetailContent(TASK_EVENT, true),
    );
    assert.equal(protectedDraft.description_, current.description_);
  });

  test(`${name} emits no success notification when persistence fails`, async () => {
    const { calls, dependencies } = fixture({
      updateTaskSingle: async () => ({ status: 409, json: { message: "Write rejected" } }),
      upsertTaskDescription: async () => { throw new Error("Write rejected"); },
    });
    const result = await loadExecute(toolName, dependencies)(input);
    assert.equal(result.success, false);
    assert.deepEqual(calls, []);
  });
}

test("AI draft publication does not notify or save another user's draft", async () => {
  const { calls, draft, dependencies } = fixture();
  draft.userId = 8;
  const result = await loadExecute("hypertask_draft", dependencies)({ action: "publish", draft_id: 100 });
  assert.equal(result.success, false);
  assert.deepEqual(calls, []);
});

test("AI draft publication does not notify or save an inaccessible task", async () => {
  const { calls, draft, dependencies } = fixture();
  draft.task.project.ownerId = 8;
  const result = await loadExecute("hypertask_draft", dependencies)({ action: "publish", draft_id: 100 });
  assert.equal(result.success, false);
  assert.deepEqual(calls, []);
});

test("AI description restore does not notify or save an inaccessible task", async () => {
  const { calls, dependencies } = fixture({ validateProjectAccess: async () => ({ error: "Denied" }) });
  const result = await loadExecute("hypertask_task_description_history", dependencies)({ action: "restore", task_id: TASK_ID, version_id: 200 });
  assert.equal(result.success, false);
  assert.deepEqual(calls, []);
});

test("listing description history emits no mutation notification", async () => {
  const { calls, dependencies } = fixture();
  const result = await loadExecute("hypertask_task_description_history", dependencies)({ action: "versions", task_id: TASK_ID });
  assert.equal(result.success, true);
  assert.deepEqual(calls, []);
});
