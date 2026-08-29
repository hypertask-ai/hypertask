const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function assertBefore(source, first, second, message) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  assert.notEqual(firstIndex, -1, `missing source invariant: ${first}`);
  assert.notEqual(secondIndex, -1, `missing source invariant: ${second}`);
  assert.ok(firstIndex < secondIndex, message);
}

test("section transition history has task and user relations", () => {
  const schema = read("src/prisma/schema.prisma");
  assert.match(
    schema,
    /model TaskSectionEvent \{[\s\S]*taskId\s+Int[\s\S]*task\s+Task[\s\S]*from\s+String\s+@db\.VarChar\(255\)[\s\S]*to\s+String\s+@db\.VarChar\(255\)[\s\S]*userId\s+Int[\s\S]*user\s+User[\s\S]*timestamp\s+DateTime\s+@default\(now\(\)\)/,
  );
  assert.match(schema, /@@index\(\[taskId, timestamp\]\)/);
  assert.match(
    read(
      "src/prisma/migrations/20260822190000_add_task_section_events/migration.sql",
    ),
    /CREATE TABLE "TaskSectionEvent"/,
  );
});

test("direct task moves write history inside the task transaction", () => {
  const controller = read("src/utils/controllers/tasks/single.ts");
  assert.match(controller, /if \(sectionChanged\) \{[\s\S]*tx\.taskSectionEvent\.create\(/);
  assert.match(controller, /from: currentState\.section/);
  assert.match(controller, /to: updatedTask\.section/);
  assert.match(controller, /userId: currentUser\.id/);
  assert.match(controller, /const sectionNameChanged =/);
  assert.match(controller, /currentState\.section !== updatedTask\.section/);
  assert.match(controller, /tx\.section\.findFirst\(/);
  assert.match(controller, /if \(sectionIdChanged && !options\.skipAutoAssign\)/);
  assertBefore(
    controller,
    "await tx.task.update({",
    "await tx.taskSectionEvent.create({",
    "the direct move event must follow the task write in the same transaction",
  );
  assertBefore(
    controller,
    "await tx.task.update({",
    "sectionIdChanged = currentState.sectionId !== updatedTask.sectionId",
    "the direct move must derive its final section transition from the saved row",
  );
});

test("section rename records one event per affected task", () => {
  const service = read("src/utils/controllers/section/sectionService.ts");
  const renameBlock = service.slice(
    service.indexOf("if (titleChanged)"),
    service.indexOf("// View updates based on operation"),
  );
  assert.match(renameBlock, /tx\.task\.updateManyAndReturn\(/);
  assert.match(renameBlock, /tx\.taskSectionEvent\.createMany\(/);
  assert.match(renameBlock, /from: existing\.section_title/);
  assert.match(renameBlock, /to: section_title/);
  assert.match(renameBlock, /userId/);
  assertBefore(
    renameBlock,
    "tx.task.updateManyAndReturn(",
    "tx.taskSectionEvent.createMany(",
    "rename history must use ids returned by the atomic cascade",
  );
});

test("section deletion records one event per moved task", () => {
  const service = read("src/utils/controllers/section/sectionService.ts");
  const moveStart = service.indexOf("if (firstSection) {");
  const deleteBlock = service.slice(
    moveStart,
    service.indexOf("await updateSection({", moveStart),
  );
  assert.match(deleteBlock, /tx\.task\.updateManyAndReturn\(/);
  assert.match(deleteBlock, /tx\.taskSectionEvent\.createMany\(/);
  assert.match(deleteBlock, /from: section\.section_title/);
  assert.match(deleteBlock, /to: firstSection\.section_title/);
  assert.match(deleteBlock, /userId/);
  assertBefore(
    deleteBlock,
    "tx.task.updateManyAndReturn(",
    "tx.taskSectionEvent.createMany(",
    "delete history must use ids returned by the atomic cascade",
  );
});
