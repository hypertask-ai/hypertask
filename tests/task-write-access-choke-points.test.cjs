const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

function assertBefore(source, first, second, message) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  assert.notStrictEqual(firstIndex, -1, `missing source invariant: ${first}`);
  assert.notStrictEqual(secondIndex, -1, `missing source invariant: ${second}`);
  assert.ok(firstIndex < secondIndex, message);
}

test("creating a task on a foreign board is refused at the shared controller", () => {
  const controller = read("src/utils/controllers/tasks/create.ts");
  assert.ok(controller.includes("taskWriteAccessWhere(currentUser.id, agentId)"));
  assertBefore(
    controller,
    "const allowedProject",
    "var taskCount = await getUniqueTaskCount(projectId)",
    "the project gate must run before creation allocates an index",
  );
  assert.match(controller, /status:\s*404[\s\S]*Project not found or access denied/);
});

test("the legacy create route cannot drift around taskWriteAccessWhere", () => {
  const route = read("src/pages/api/tasks/create.ts");
  const fullScreenHelper = route.slice(route.indexOf("export const createFullScreenTaskAndReturn"));
  assert.ok(route.includes("currentUser:userObj,agentId"));
  assert.ok(fullScreenHelper.includes("const response = await create({"));
  assert.ok(
    !fullScreenHelper.includes("prisma.task.create("),
    "full-screen creation must also go through the gated controller",
  );
});

test("task creation still permits a board owner", () => {
  const access = read("src/utils/controllers/projects/getAllIncludes.ts");
  assert.ok(access.includes("{ ownerId: userId }"));
});

test("task creation still permits a human board member", () => {
  const access = read("src/utils/controllers/projects/getAllIncludes.ts");
  assert.ok(access.includes("members: { some: { userId, agentId: null } }"));
});

test("task creation still permits an owned live board agent", () => {
  const access = read("src/utils/controllers/projects/getAllIncludes.ts");
  assert.ok(access.includes("agent: { userId, revokedAt: null }"));
  const globalCreate = read("src/pages/api/tasks/createGlobally.ts");
  assert.ok(globalCreate.includes("taskWriteAccessWhere(userId, agentId)"));
});

test("global task creation refuses a foreign project before its transaction", () => {
  const source = read("src/pages/api/tasks/createGlobally.ts");
  assertBefore(
    source,
    "const authorizedProject",
    "const created = await createTaskWithBoardWebhookOutbox",
    "global creation must be gated before the transaction writes",
  );
  assert.match(source, /if \(!authorizedProject\)[\s\S]*status\(403\)/);
});

test("task recovery refuses a foreign task before cancelling or writing", () => {
  const source = read("src/pages/api/tasks/recoverTask.ts");
  assert.ok(source.includes("getSessionUser("));
  assert.ok(!source.includes("JSON.parse(req.cookies.nookies_user"));
  assert.ok(source.includes("project: taskWriteAccessWhere(session.userId, actingAgentId)"));
  assert.match(source, /id: actingAgentId,[\s\S]*userId: session\.userId,[\s\S]*revokedAt: null/);
  assertBefore(source, "const [allowedTask, ownedAgent]", "const updatedTask = await updateTaskAndSubtasks", "recovery must gate before restoring the task");
  assert.match(source, /status\(404\)[\s\S]*Task not found or access denied/);
});

test("rank reset refuses the whole batch when any task is foreign", () => {
  const source = read("src/pages/api/section/resetRanks.ts");
  assert.ok(source.includes("project: taskWriteAccessWhere(currentUser.id, agentId)"));
  assert.ok(source.includes("projectIds.length !== uniqueTaskIds.length"));
  assertBefore(source, "projectIds.length !== uniqueTaskIds.length", "for (const task of taskIds)", "rank writes must follow the batch gate");
  assert.match(source, /status\(404\)[\s\S]*Task not found or access denied/);
});

test("the delete scheduler refuses a foreign task before mutating it", () => {
  const source = read("src/pages/api/queues/tasks/taskDeleteReminder.ts");
  assert.ok(source.includes("getSessionUser("));
  assert.ok(!source.includes("JSON.parse(req.cookies.nookies_user"));
  assert.ok(source.includes("project: taskWriteAccessWhere(session.userId, actingAgentId)"));
  assert.match(source, /id: actingAgentId,[\s\S]*userId: session\.userId,[\s\S]*revokedAt: null/);
  assertBefore(source, "const [allowedTask, ownedAgent]", "const taskUpdated = await updateTaskTreeStatus", "soft deletion must follow the task gate");
  assert.match(source, /status\(404\)[\s\S]*Task not found or access denied/);
});

test("comment creation refuses a foreign task before dedupe or writes", () => {
  const service = read("src/utils/controllers/comments/createCommentService.ts");
  assert.match(service, /taskWriteAccessWhere\(\s*accessUserId \?\? currentUser\.id,\s*agentId/);
  assertBefore(service, "const task = await prisma.task.findFirst", "const handledInvocation =", "comment access must be checked before idempotency checks can return data");
  assertBefore(service, "const task = await prisma.task.findFirst", "const duplicate =", "comment access must be checked before text dedupe can return data");
  assertBefore(service, "const task = await prisma.task.findFirst", "const comment = await tx.comment.create", "comment access must be checked before writes");
  assert.ok(service.includes('throw new Error("Task not found or access denied")'));
});

test("AI comment routes prove write access before paid generation or upload", () => {
  const hyperMention = read("src/app/api/ai/hyper-mentioned/route.ts");
  assert.ok(hyperMention.includes("project: taskWriteAccessWhere(requestUser.id)"));
  assertBefore(
    hyperMention,
    "const writableTask",
    "const result = await generateText",
    "HyperAI must reject read-only callers before model inference",
  );

  const imageRoute = read("src/app/api/ai/generate-image/route.ts");
  assert.ok(imageRoute.includes("project: taskWriteAccessWhere(cookieUser.id)"));
  assertBefore(
    imageRoute,
    "teamContext.projectId !== body.projectId",
    "const image =",
    "image generation must reject read-only callers before model inference",
  );
  assertBefore(
    imageRoute,
    "teamContext.projectId !== body.projectId",
    "uploadTaskAttachmentToS3(",
    "image generation must reject read-only callers before uploading",
  );
});

test("the legacy comment route cannot impersonate HyperAI or another user", () => {
  const route = read("src/pages/api/comments/create.ts");
  assert.ok(!route.includes("isHyperAi"));
  assert.ok(!route.includes("NEXT_PUBLIC_HYPERAI_ID"));
  assertBefore(
    route,
    "Number(creatorId) !== Number(currentUser.id)",
    "createCommentService({",
    "the authenticated author must be proven before comment creation",
  );
  assert.match(route, /status\(403\)\.json\(\{ message: "Forbidden" \}\)/);
});

test("the userless hard-delete worker stays signature-gated instead", () => {
  const worker = read("src/pages/api/queues/taskDeleteQueue.ts");
  assert.ok(worker.includes("export default withQstashSignature(handler)"));
  assert.ok(worker.includes("claimAndInvokeTaskDelete(taskId)"));
  assert.ok(worker.includes("This callback has no request user"));
  assert.ok(!worker.includes("taskWriteAccessWhere"));
});
