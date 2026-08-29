const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/ai-bulk-tools-entry.cjs"), {
  interopDefault: true,
});
const {
  buildCollectionMetadata,
  buildEmptyCompletionSummary,
  buildLimitedScanMetadata,
  buildSearchTotalMetadata,
  decideTaskIdentifierMatch,
  hasVisibleCompletion,
  resolveBulkTaskTargets,
  resolveUserIds,
  toolResultPartiallySucceeded,
  toolResultSucceeded,
} = jiti(path.join(root, "src/app/api/ai/chat/stream/bulkTools.ts"));

test("ticket number takes precedence when both identifiers resolve together", () => {
  assert.deepEqual(
    decideTaskIdentifierMatch({
      taskId: 42,
      ticketNumber: "HTPR-42",
      projectId: 15,
      taskMatch: { id: 42, projectId: 15 },
      ticketMatch: { id: 42, projectId: 15 },
    }),
    { match: { id: 42, projectId: 15 } }
  );
});

test("conflicting task and ticket identifiers fail instead of choosing one", () => {
  const result = decideTaskIdentifierMatch({
    taskId: 99,
    ticketNumber: "HTPR-42",
    projectId: 15,
    taskMatch: { id: 99, projectId: 15 },
    ticketMatch: { id: 42, projectId: 15 },
  });
  assert.equal(result.match, null);
  assert.match(result.error, /ticket_number=HTPR-42/);
  assert.match(result.error, /task_id=99/);
});

test("task id from another project is an identifier conflict", () => {
  const result = decideTaskIdentifierMatch({
    taskId: 99,
    projectId: 15,
    taskMatch: null,
    ticketMatch: null,
    unscopedTaskMatch: { id: 99, projectId: 12 },
  });
  assert.equal(result.match, null);
  assert.match(result.error, /belongs to project_id=12, not project_id=15/);
});

test("cross-project conflicts name both supplied identifiers", () => {
  const result = decideTaskIdentifierMatch({
    taskId: 99,
    ticketNumber: "HTPR-42",
    projectId: 15,
    taskMatch: null,
    ticketMatch: { id: 42, projectId: 15 },
    unscopedTaskMatch: { id: 99, projectId: 12 },
  });
  assert.match(result.error, /ticket_number=HTPR-42/);
  assert.match(result.error, /task_id=99/);
});

test("bulk task targets resolve task_ids and project-scoped ticket_numbers", () => {
  assert.deepEqual(
    resolveBulkTaskTargets({
      task_id: 99,
      task_ids: [11, 12],
      ticket_numbers: ["HTPR-1", "HTPR-2"],
      project_id: 15,
    }),
    [
      { task_id: 11 },
      { task_id: 12 },
      { ticket_number: "HTPR-1", project_id: 15 },
      { ticket_number: "HTPR-2", project_id: 15 },
    ]
  );
});

test("single task target shape remains unchanged", () => {
  assert.deepEqual(
    resolveBulkTaskTargets({
      task_id: 11,
      ticket_number: "HTPR-11",
      unique_index: 11,
      project_id: 15,
    }),
    [{
      task_id: 11,
      ticket_number: "HTPR-11",
      unique_index: 11,
      project_id: 15,
    }]
  );
});

test("user references resolve me, display names, emails, and legacy user_ids", () => {
  const members = [
    { id: 6, displayName: "Valentin Yeo", email: "valentin@hypertask.ai" },
    { id: 42, displayName: "Ada Lovelace", email: "ada@example.com" },
  ];
  assert.deepEqual(
    resolveUserIds(
      {
        user_ids: [42],
        users: ["me", " ADA LOVELACE ", "ada@example.com", 6],
      },
      6,
      members
    ),
    { userIds: [42, 6], agentIds: [], failures: [] }
  );
});

test("user references fail clearly for unknown, ambiguous, and non-member users", () => {
  const result = resolveUserIds(
    { users: ["Sam", "missing@example.com", 99] },
    6,
    [
      { id: 7, displayName: "Sam", email: "sam.one@example.com" },
      { id: 8, displayName: "Sam", email: "sam.two@example.com" },
    ]
  );
  assert.deepEqual(result.userIds, []);
  assert.deepEqual(result.agentIds, []);
  assert.match(result.failures[0].error, /Multiple project members match/);
  assert.match(result.failures[1].error, /No project member or board agent/);
  assert.match(result.failures[2].error, /not a member/);
});

function unassignResult(changed, failed) {
  return {
    success: true,
    changed,
    tasks: Array.from({ length: changed }, (_, index) => ({
      task_id: index + 1,
      changed: 1,
      changed_user_ids: [6],
    })),
    failures: Array.from({ length: failed }, (_, index) => ({
      task_id: changed + index + 1,
      user: "me",
      error: "Failed",
    })),
  };
}

test("complete bulk results report real entity counts", () => {
  const result = unassignResult(18, 0);
  assert.equal(toolResultSucceeded(result), true);
  assert.equal(toolResultPartiallySucceeded(result), false);
  assert.equal(
    buildEmptyCompletionSummary({
      toolExecutions: [{ name: "hypertask_unassign_user", result }],
      writeToolNames: new Set(["hypertask_unassign_user"]),
      reachedStepLimit: true,
      maxToolSteps: 32,
      currentUserId: 6,
    }),
    "I reached the 32-step processing limit. Before stopping: I unassigned you from 18 tasks."
  );
});

test("partial bulk results name successful and failed entity counts", () => {
  const result = unassignResult(11, 7);
  assert.equal(toolResultSucceeded(result), false);
  assert.equal(toolResultPartiallySucceeded(result), true);
  const summary = buildEmptyCompletionSummary({
    toolExecutions: [{ name: "hypertask_unassign_user", result }],
    writeToolNames: new Set(["hypertask_unassign_user"]),
    reachedStepLimit: true,
    maxToolSteps: 32,
    currentUserId: 6,
  });
  assert.match(summary, /unassigned you from 11 tasks/);
  assert.match(summary, /7 task-user changes failed/);
  assert.doesNotMatch(summary, /actions completed|completed.*unassign/i);
});

test("all-failed bulk results are total failures, not partial successes", () => {
  const result = {
    success: false,
    tasks: [],
    failures: [{ task_id: 1, error: "Failed" }],
  };
  assert.equal(toolResultSucceeded(result), false);
  assert.equal(toolResultPartiallySucceeded(result), false);
});

test("bounded scans distinguish exact totals from truncated lower bounds", () => {
  assert.deepEqual(buildLimitedScanMetadata(500, 500), {
    total: 500,
    truncated: false,
  });
  assert.deepEqual(buildLimitedScanMetadata(501, 500), {
    total: 500,
    truncated: true,
  });
});

test("collection totals flag inbox pages truncated by their limit", () => {
  assert.deepEqual(buildCollectionMetadata(73, 50), {
    total: 73,
    truncated: true,
  });
  assert.deepEqual(buildCollectionMetadata(12, 12), {
    total: 12,
    truncated: false,
  });
});

test("search totals disclose candidate-set lower bounds", () => {
  assert.deepEqual(buildSearchTotalMetadata(100, true), {
    total: 100,
    total_is_lower_bound: true,
    total_scope: "candidate_set",
  });
  assert.deepEqual(buildSearchTotalMetadata(27, false), {
    total: 27,
    total_is_lower_bound: false,
    total_scope: "all_database_matches",
  });
});

test("uncounted tool failures never read as an idempotent no-op", () => {
  const summary = buildEmptyCompletionSummary({
    toolExecutions: [{
      name: "hypertask_unassign_user",
      result: { success: false, error: "Unexpected failure" },
    }],
    writeToolNames: new Set(["hypertask_unassign_user"]),
    reachedStepLimit: false,
    maxToolSteps: 32,
    currentUserId: 6,
  });
  assert.match(summary, /No unassignment changes succeeded/);
  assert.match(summary, /failed before entity counts were available/);
  assert.doesNotMatch(summary, /changes were needed/);
});

test("uncounted failures from other write tools remain visible", () => {
  const summary = buildEmptyCompletionSummary({
    toolExecutions: [{
      name: "hypertask_create_label",
      result: { success: false, error: "Unexpected failure" },
    }],
    writeToolNames: new Set(["hypertask_create_label"]),
    reachedStepLimit: false,
    maxToolSteps: 32,
  });
  assert.match(summary, /No write actions succeeded/);
  assert.match(summary, /failed before entity counts were available/);
});

test("empty completion only blames the step limit when it was reached", () => {
  const summary = buildEmptyCompletionSummary({
    toolExecutions: [],
    writeToolNames: new Set(),
    reachedStepLimit: false,
    maxToolSteps: 32,
  });
  assert.match(summary, /^The model returned no final response\./);
  assert.match(summary, /Try rephrasing/);
  assert.doesNotMatch(summary, /step processing limit/);
});

test("whitespace-only model chunks are still an empty completion", () => {
  assert.equal(hasVisibleCompletion([]), false);
  assert.equal(hasVisibleCompletion(["", "  ", "\n\t"]), false);
  assert.equal(hasVisibleCompletion(["  ", "answer"]), true);
});
