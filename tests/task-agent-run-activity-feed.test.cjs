const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const load = (relativePath) =>
  createJiti(__filename, {
    alias: { "@": path.join(root, "src") },
    interopDefault: true,
  })(path.join(root, relativePath));

const { mergeTaskThreadFeed, safeAgentRunActivityLink } = load(
  "src/lib/agentRuns/taskActivityFeed.ts",
);

const comment = (id, createdAt, activity = null) => ({
  id: String(id),
  createdAt,
  activity,
});
const runActivity = (id, type, createdAt) => ({
  id,
  runId: "run-1",
  type,
  text: id,
  link: null,
  options: null,
  selectedOption: null,
  selectedAt: null,
  selectedBy: null,
  createdAt,
});

test("task thread feed merges chronologically without changing comment indexes", () => {
  const comments = [
    comment(10, "2026-09-04T10:00:00.000Z"),
    comment(11, "2026-09-04T10:02:00.000Z", { type: "TaskMoved" }),
    comment(12, "2026-09-04T10:04:00.000Z"),
  ];
  const activities = [
    runActivity("thought", "thought", "2026-09-04T10:01:00.000Z"),
    runActivity("response", "response", "2026-09-04T10:03:00.000Z"),
    runActivity("error", "error", "2026-09-04T10:03:30.000Z"),
  ];

  assert.deepEqual(
    mergeTaskThreadFeed(comments, activities, false).map((item) => [
      item.kind,
      item.kind === "comment" ? item.commentIndex : item.activityIndex,
    ]),
    [
      ["comment", 0],
      ["agent-activity", 0],
      ["agent-activity", 2],
      ["comment", 2],
    ],
  );
  assert.deepEqual(
    mergeTaskThreadFeed(comments, activities, true).map(({ id }) => id),
    [
      "comment-10",
      "agent-activity-thought",
      "comment-11",
      "agent-activity-error",
      "comment-12",
    ],
  );
});

test("task activity links allow only http and https", () => {
  assert.equal(
    safeAgentRunActivityLink("https://example.com/result"),
    "https://example.com/result",
  );
  assert.equal(safeAgentRunActivityLink("javascript:alert(1)"), null);
  assert.equal(safeAgentRunActivityLink("not a url"), null);
});

test("passive activity row keeps selection accessible and reconciles through comments", () => {
  const source = fs.readFileSync(
    path.join(
      root,
      "src/components/PageComponents/TaskDetail/CommentAndDescription/AgentRunActivityRow.tsx",
    ),
    "utf8",
  );

  assert.match(source, /min-h-11 min-w-11/);
  assert.match(source, /aria-pressed=\{selected\}/);
  assert.match(source, /aria-disabled=\{blocked\}/);
  assert.match(source, /rel="noopener noreferrer"/);
  assert.match(source, /refreshTaskComments\(queryClient, taskId\)/);
  assert.match(source, /response\.status === 409/);
});

test("comments route uses signed session identity and private no-store responses", () => {
  const source = fs.readFileSync(
    path.join(root, "src/pages/api/comments/getByTask.ts"),
    "utf8",
  );

  assert.match(source, /getSessionUser/);
  assert.doesNotMatch(source, /nookies_user/);
  assert.match(source, /private, no-store/);
  assert.match(source, /res\.setHeader\("Vary", "Cookie"\)/);
});

test("comments payload carries activities separately from comments", () => {
  const controller = fs.readFileSync(
    path.join(root, "src/utils/controllers/comments/getByTask.ts"),
    "utf8",
  );
  const client = fs.readFileSync(
    path.join(root, "src/utils/api/Task Detail/index.ts"),
    "utf8",
  );

  assert.match(controller, /json: \{ comments: filteredComments, lastReadAt, agentRunActivities \}/);
  assert.match(client, /agentRunActivities = Array\.isArray/);
});
