const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/loadModule.cjs");

const { default: definition, HTPR_8742_ATTACHMENT_DOWNLOAD_HINT_FLAG } = require("./helpers/flag-files.cjs").load("src/lib/flags/definitions/htpr-8742-attachment-download-hint.ts");
const { attachmentDownloadHint, withAttachmentDownloadHints } = loadModule("src/lib/mcp/operations/tasks/operation.ts", {
  "@/lib/auth/agentScope": { agentScopeEnforced: () => false, recordAgentBoardScopeMiss: () => {} },
  "@/lib/tasks/sameBoardRelations": { stripForeignTaskRelations: (task) => task },
  "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: () => {} },
  "@/lib/mcp/routeWrapper": {
    wrapMcpRoute: (handler) => handler,
    validateMcpRouteAuth: async () => ({}),
    checkMcpRouteRateLimit: async () => null,
    mcpRouteUnauthorizedResponse: () => ({}),
  },
  "next/server": { NextRequest: class {}, NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } },
  "@prisma/client": { Prisma: { DbNull: null } },
  "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
  "@/lib/mcp/agents": { mapVisibleMcpAgent: () => null, mcpVisibleAgentSelect: () => ({}) },
  "@/lib/agents/visibility": { accessibleAgentWhere: () => ({}) },
  "@/lib/mcp/tasks/mappers": {
    mapMcpTaskLabel: () => ({}),
    mapTaskAssignee: () => null,
    mapTaskDescriptionContent: () => "",
    mapTaskToMcpGetResponse: (task) => task,
    mcpTaskLabelSelect: {},
    taskMcpGetInclude: () => ({}),
    mcpTaskUserCommentCount: true,
  },
  "@/lib/pullRequests/taskPullRequests": { refreshTaskPullRequests: async (_id, rows) => rows },
  "@/lib/mcp/tasks/resolveTask": { findTaskByIdentifier: async () => null, taskIdentifierErrorResponse: () => null },
  "@/lib/mcp/pagination/cursor": { decodeCursor: () => null, encodeCursor: () => null },
  "@/lib/prisma": { default: {} },
  "@/lib/flags": { isFeatureEnabled: async () => false },
  "@/lib/flags/keys": {},
  "@/lib/mcp/listQuery": {},
  "@/lib/mcp/readListQuery": { readListQuery: () => ({}) },
  "@/lib/mcp/priorityFilter": { parsePriorityFilter: () => [] },
  "@/lib/mcp/listParams": {},
  "@/lib/doneColumns": { isDoneColumn: () => false },
  "@/lib/mcp/boards/columnRole": { columnRole: () => "" },
  "@/utils/controllers/notifications/inboxZero": { loadDoneTitlesByProject: async () => new Map() },
});

test("attachment download hint names the authenticated request", () => {
  assert.equal(HTPR_8742_ATTACHMENT_DOWNLOAD_HINT_FLAG, "htpr-8742-attachment-download-hint");
  assert.equal(definition.key, HTPR_8742_ATTACHMENT_DOWNLOAD_HINT_FLAG);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(
    attachmentDownloadHint(88, 12),
    "GET /api/mcp/tasks/attachments?task_id=88&attachment_id=12 with the same bearer token. fileSource is not an agent download.",
  );
});

test("download instructions appear only when the flag is on", () => {
  const task = {
    id: 88,
    attachments: [{ id: 12, fileName: "shot.png", fileSource: "https://files.example/shot.png" }],
  };
  const off = withAttachmentDownloadHints(task, false);
  assert.equal(off, task);
  assert.equal(Object.hasOwn(off.attachments[0], "download"), false);
  const on = withAttachmentDownloadHints(task, true);
  assert.equal(on.attachments[0].fileSource, task.attachments[0].fileSource);
  assert.equal(on.attachments[0].download, attachmentDownloadHint(88, 12));
  const empty = { id: 88 };
  assert.equal(withAttachmentDownloadHints(empty, true), empty);
});
