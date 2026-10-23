const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

function fixture(userId = 1) {
  const tasks = [
    { id: 91, projectId: 15, memberIds: [1, 2] },
    { id: 92, projectId: 16, memberIds: [2] },
  ];
  const drafts = [
    { id: 1, taskId: 91, userId: 1, type: "Comment", content: "A comment", updatedAt: new Date("2026-10-20T10:00:00Z") },
    { id: 2, taskId: 91, userId: 2, type: "Comment", content: "B_PRIVATE_SENTINEL", updatedAt: new Date("2026-10-22T10:00:00Z") },
    { id: 3, taskId: 91, userId: 1, type: "Description", content: "A description", updatedAt: new Date("2026-10-21T10:00:00Z") },
    { id: 4, taskId: 91, userId: 1, type: "Comment", content: "<p></p>", updatedAt: new Date("2026-10-23T10:00:00Z") },
    { id: 5, taskId: 92, userId: 1, type: "Comment", content: "Other task draft", updatedAt: new Date("2026-10-24T10:00:00Z") },
  ];
  const queries = [];
  const { createDraftTool } = load("src/lib/ai/tools/draft.ts", {
    ai: { tool: (definition) => definition },
    "./schemas": { inlineAgentImageFields: () => ({}) },
    "@/lib/prisma": { default: {
      drafts: {
        findMany: async ({ where, orderBy }) => {
          queries.push(where);
          const rows = drafts.filter((draft) => Object.entries(where).every(([key, value]) => {
            if (key === "content") {
              assert.deepEqual(Object.keys(value), ["not"]);
              return draft.content !== value.not;
            }
            return draft[key] === value;
          }));
          if (orderBy?.updatedAt) {
            rows.sort((a, b) => (a.updatedAt - b.updatedAt) * (orderBy.updatedAt === "desc" ? -1 : 1));
          }
          return rows;
        },
      },
    } },
    "@/lib/ai/tools/execution": {
      withToolErrors: (execute) => execute,
      resolveTaskForTool: async (user, input) => {
        const task = tasks.find((row) => row.id === input.task_id && row.memberIds.includes(user.id));
        return task ? { task } : { error: "Task not found or access denied" };
      },
    },
    "@/lib/ai/tools/helpers": {
      sanitizeForJson: (value) => value,
      mapDraftToResponse: (draft) => draft,
    },
    "@/lib/media/inlineAgentImages.server": {},
    "@/utils/helperFunctions/toStoredHtml": {},
    "@/utils/controllers/comments/linkifyTicketRefs": {},
    "@/utils/helperFunctions/multiPages/multipages.functions": {},
    "@/utils/controllers/comments/createCommentService": {},
    "@/utils/controllers/urls/extractUrlsFromContent": {},
    "@/lib/realtime/server": {},
    "@/utils/controllers/tasks/single": {},
    "@/lib/ai/chatStream/prompt": { COMMENT_TASK_LINK_RULE: "" },
    "@/lib/ai/tools/constants": { TOOL_TASK_ID_DESCRIPTION: "Task ID" },
  });
  return {
    execute: createDraftTool({ user: { id: userId }, sendStatus() {} }).hypertask_draft.execute,
    queries,
  };
}

test("now refused: a task member cannot list another member's private draft", async () => {
  const result = await fixture().execute({ action: "list", task_id: 91 });
  assert.equal(result.success, true);
  assert.equal(result.drafts.some((draft) => draft.userId === 2), false);
  assert.doesNotMatch(JSON.stringify(result), /B_PRIVATE_SENTINEL/);

  const ownerResult = await fixture(2).execute({ action: "list", task_id: 91 });
  assert.equal(ownerResult.success, true);
  assert.deepEqual(ownerResult.drafts.map((draft) => draft.id), [2]);
  assert.match(JSON.stringify(ownerResult), /B_PRIVATE_SENTINEL/);
});

test("still allowed: caller comment and description drafts are returned newest first", async () => {
  const result = await fixture().execute({ action: "list", task_id: 91 });
  assert.equal(result.success, true);
  assert.deepEqual(result.drafts.map((draft) => ({
    id: draft.id,
    userId: draft.userId,
    type: draft.type,
    content: draft.content,
  })), [
    { id: 3, userId: 1, type: "Description", content: "A description" },
    { id: 1, userId: 1, type: "Comment", content: "A comment" },
  ]);
});

test("inaccessible tasks are denied before querying drafts", async () => {
  const h = fixture();
  const result = await h.execute({ action: "list", task_id: 92 });
  assert.deepEqual(result, { success: false, error: "Task not found or access denied" });
  assert.equal(h.queries.length, 0);
});
