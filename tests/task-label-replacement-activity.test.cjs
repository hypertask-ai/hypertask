const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function loadSetTaskLabels({ existingTaskLabels, activities, deletes, creates, taskRows }) {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/lib/mcp/tasks/services.ts"),
    "utf8"
  );
  const start = source.indexOf("export async function setTaskLabels");
  assert.notEqual(start, -1, "setTaskLabels must exist in services.ts");
  const helperStart = source.lastIndexOf(
    "async function assertTaskBelongsToProject",
    start,
  );
  assert.notEqual(helperStart, -1, "task project validation must exist in services.ts");
  const end = source.indexOf("export async function mutateTaskLabels", start);
  assert.notEqual(end, -1, "mutateTaskLabels must follow setTaskLabels");

  const snippet = source
    .slice(helperStart, end)
    .replace("export async function", "async function");
  const javascript = ts.transpileModule(snippet, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;

  const expectedTaskId = 42;
  const expectedProjectId = 15;
  const prisma = {
    $transaction: async (callback) => callback(prisma),
    $queryRaw: async (strings, taskId, projectId) => {
      assert.match(strings.join(""), /WHERE "id" = /);
      assert.match(strings.join(""), /AND "projectId" = /);
      assert.equal(taskId, expectedTaskId);
      assert.equal(projectId, expectedProjectId);
      const rows = taskRows ?? [{ projectId: expectedProjectId }];
      return rows.filter((row) => row.projectId === projectId);
    },
    taskLabel: {
      findMany: async () => existingTaskLabels,
      deleteMany: async (args) => {
        deletes.push(args);
        return { count: args.where.labelId.in.length };
      },
      create: async (args) => {
        creates.push(args);
        return {
          id: `task-label-${args.data.labelId}`,
          ...args.data,
          label: { id: args.data.labelId, value: args.data.labelId },
        };
      },
    },
  };
  const resolveLabelIds = async (_projectId, labelIds) => labelIds.map(String);
  const createLabelActivity = (activity) => activities.push(activity);
  const emitAgentLabelChangeWebhook = async () => [];
  const publishAgentWebhookDeliveries = async () => {};
  class TaskProjectScopeError extends Error {
    constructor(taskId) {
      super(`Task ${taskId} was not found in the requested project`);
    }
  }

  return new Function(
    "resolveLabelIds",
    "prisma",
    "createLabelActivity",
    "emitAgentLabelChangeWebhook",
    "publishAgentWebhookDeliveries",
    "TaskProjectScopeError",
    `${javascript}; return setTaskLabels;`
  )(
    resolveLabelIds,
    prisma,
    createLabelActivity,
    emitAgentLabelChangeWebhook,
    publishAgentWebhookDeliveries,
    TaskProjectScopeError,
  );
}

function taskLabel(labelId) {
  return {
    id: `existing-${labelId}`,
    taskId: 42,
    labelId,
    label: { id: labelId, value: labelId },
  };
}

function setup(existingTaskLabels, taskRows) {
  const activities = [];
  const deletes = [];
  const creates = [];
  return {
    activities,
    deletes,
    creates,
    setTaskLabels: loadSetTaskLabels({
      existingTaskLabels,
      activities,
      deletes,
      creates,
      taskRows,
    }),
  };
}

const actor = { id: 6, email: "valentin@example.com", displayName: "Valentin" };

test("removing a label emits a Removed TaskLabel activity", async () => {
  const harness = setup([taskLabel("A")]);

  await harness.setTaskLabels(42, 15, [], actor);

  assert.equal(harness.activities.length, 1);
  assert.equal(harness.activities[0].status, "Removed");
  assert.equal(harness.activities[0].toTaskLabel.labelId, "A");
  assert.deepEqual(harness.deletes[0].where.labelId.in, ["A"]);
  assert.equal(harness.creates.length, 0);
});

test("replacing label A with label B emits one removal and one addition", async () => {
  const harness = setup([taskLabel("A")]);

  await harness.setTaskLabels(42, 15, ["B"], actor);

  assert.deepEqual(
    harness.activities.map(({ status, toTaskLabel }) => [status, toTaskLabel.labelId]),
    [
      ["Removed", "A"],
      ["Assigned", "B"],
    ]
  );
  assert.deepEqual(harness.deletes[0].where.labelId.in, ["A"]);
  assert.equal(harness.creates.length, 1);
  assert.equal(harness.creates[0].data.labelId, "B");
});

test("re-sending an identical label set emits no activity", async () => {
  const harness = setup([taskLabel("A"), taskLabel("B")]);

  await harness.setTaskLabels(42, 15, ["A", "B"], actor);

  assert.equal(harness.activities.length, 0);
  assert.equal(harness.deletes.length, 0);
  assert.equal(harness.creates.length, 0);
});

test("rejecting an unknown task stops before label mutation", async () => {
  const harness = setup([], []);

  await assert.rejects(
    harness.setTaskLabels(42, 15, ["A"], actor),
    /Task 42 was not found in the requested project/,
  );
  assert.equal(harness.activities.length, 0);
  assert.equal(harness.deletes.length, 0);
  assert.equal(harness.creates.length, 0);
});

test("rejecting a task from another project stops before label mutation", async () => {
  const harness = setup([], [{ projectId: 99 }]);

  await assert.rejects(
    harness.setTaskLabels(42, 15, ["A"], actor),
    /Task 42 was not found in the requested project/,
  );
  assert.equal(harness.activities.length, 0);
  assert.equal(harness.deletes.length, 0);
  assert.equal(harness.creates.length, 0);
});
