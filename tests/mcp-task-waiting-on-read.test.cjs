const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

const mappers = load("src/lib/mcp/tasks/mappers.ts", {
  "@/lib/auth/agentScope": { agentScopeEnforced: () => false, recordAgentBoardScopeMiss: () => {} },
  "@/lib/tasks/sameBoardRelations": { stripForeignTaskRelations: (task) => task },
  "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: () => ({}) },
  "@/lib/mcp/agents": { mapVisibleMcpAgent: () => undefined, mcpVisibleAgentSelect: () => ({}) },
  "@/lib/agents/visibility": { accessibleAgentWhere: () => ({}) },
  "@/lib/staleness": { taskStaleness: () => ({ stale: false }) },
  "@/lib/pullRequests/githubPullRequests": { derivePullRequestDisplayState: () => "open" },
});

const waitingTask = (overrides = {}) => ({
  id: 87476,
  ticketNumber: "HTPR-8478",
  uniqueIndex: 8478,
  title: "Moving a ticket to Valentin Review clears the waiting person",
  section: "Valentin Review",
  sectionId: 4311,
  projectId: 15,
  project: { id: 15, title: "Hypertask", staleWarnDays: 7, staleHotDays: 14 },
  status: "Normal",
  userId: 6,
  blockerCommentId: 1234,
  waitingOnUserId: 6,
  waitingOnSetById: 6,
  waitingOnSetAt: new Date("2026-11-03T22:21:26.120Z"),
  createdAt: new Date("2026-11-03T21:15:55.082Z"),
  updatedAt: new Date("2026-11-03T22:21:26.120Z"),
  user: { id: 6, email: "valentin@yeo.test", displayName: "Valentin" },
  agent: null,
  assignees: [],
  followers: [],
  taskLabels: [],
  attachments: [],
  customFieldValues: [],
  savedContent: [],
  pullRequests: [],
  subTasks: [],
  parentTask: null,
  _count: { comments: 0 },
  ...overrides,
});

test("task reads report the waiting person so a move cannot look like a clear", () => {
  const detail = mappers.mapTaskToDetail(waitingTask(), 6);
  assert.equal(detail.waitingOnUserId, 6);
  assert.equal(detail.waitingOnSetAt, "2026-11-03T22:21:26.120Z");
  assert.equal(detail.blockerCommentId, 1234);

  const summary = mappers.mapTaskToMcpGetResponse(waitingTask(), 6);
  assert.equal(summary.waitingOnUserId, 6);
  assert.equal(summary.waitingOnSetAt, "2026-11-03T22:21:26.120Z");
  assert.equal(summary.blockerCommentId, 1234);
});

test("a task with no waiting person reports null instead of omitting the field", () => {
  const detail = mappers.mapTaskToDetail(waitingTask({ waitingOnUserId: null, waitingOnSetAt: null, blockerCommentId: null }), 6);
  assert.equal(detail.waitingOnUserId, null);
  assert.equal(detail.waitingOnSetAt, null);
  assert.equal(detail.blockerCommentId, null);

  const summary = mappers.mapTaskToMcpGetResponse(waitingTask({ waitingOnUserId: null, waitingOnSetAt: null, blockerCommentId: null }), 6);
  assert.equal(summary.waitingOnUserId, null);
  assert.equal(summary.waitingOnSetAt, null);
});

test("a waiting person set by a serialized read still renders as an ISO timestamp", () => {
  const detail = mappers.mapTaskToDetail(waitingTask({ waitingOnSetAt: "2026-11-03T22:21:26.120Z" }), 6);
  assert.equal(detail.waitingOnSetAt, "2026-11-03T22:21:26.120Z");
});

test("flag off hides stored waiting agents on MCP reads", () => {
  const task = waitingTask({
    waitingOnUserId: null,
    waitingOnAgentId: "11111111-1111-4111-8111-111111111111",
    waitingOnAgent: { id: "11111111-1111-4111-8111-111111111111", displayName: "Runner 9", userId: 6, visibility: "TEAM", members: [{ projectId: 15 }] },
  });
  const summary = mappers.mapTaskToMcpGetResponse(task, 6, null, null, false);
  assert.equal(summary.waitingOnUserId, null);
  assert.equal(summary.waitingOnSetAt, "2026-11-03T22:21:26.120Z");
  assert.equal(summary.waitingOnAgentId, undefined);
});

test("every read path shares one waiting mapping, so list and detail cannot drift", () => {
  assert.deepEqual(mappers.mapTaskWaitingOn({ waitingOnUserId: 6, waitingOnSetAt: new Date("2026-11-03T22:21:26.120Z") }), {
    waitingOnUserId: 6,
    waitingOnSetAt: "2026-11-03T22:21:26.120Z",
  });
  assert.deepEqual(mappers.mapTaskWaitingOn({}), { waitingOnUserId: null, waitingOnSetAt: null });
});
