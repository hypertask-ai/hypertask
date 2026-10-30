const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { z } = require("zod");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  cache: false,
  alias: { "@": path.join(root, "src") },
});
const {
  GetTaskInputSchema,
  getGetTasksBaseSchema,
} = jiti(path.join(root, "src/lib/mcp-server/validations/task.validation.ts"));

test("get_tasks accepts a single ticket number as a string", () => {
  assert.ok(getGetTasksBaseSchema().safeParse({ ticket_number: "INNE-1814" }).success);
  assert.deepStrictEqual(GetTaskInputSchema.parse({ ticket_number: "INNE-1814" }).ticket_number, ["INNE-1814"]);
});

test("get_tasks still accepts a list of ticket numbers", () => {
  assert.ok(getGetTasksBaseSchema().safeParse({ ticket_number: ["INNE-1814", "HTPR-1"] }).success);
  assert.deepStrictEqual(GetTaskInputSchema.parse({ ticket_number: ["INNE-1814", "HTPR-1"] }).ticket_number, ["INNE-1814", "HTPR-1"]);
});

test("get_tasks accepts a single task id as a number or string", () => {
  assert.deepStrictEqual(GetTaskInputSchema.parse({ task_id: 60851 }).task_id, [60851]);
  assert.deepStrictEqual(GetTaskInputSchema.parse({ task_id: "60851" }).task_id, [60851]);
  assert.ok(getGetTasksBaseSchema().safeParse({ task_id: 60851 }).success);
});

test("get_tasks still rejects bad and missing identifiers", () => {
  assert.strictEqual(GetTaskInputSchema.safeParse({ ticket_number: "bad ticket!" }).success, false);
  assert.strictEqual(GetTaskInputSchema.safeParse({ ticket_number: [] }).success, false);
  assert.strictEqual(GetTaskInputSchema.safeParse({}).success, false);
});

test("get_tasks wire schema still converts to JSON schema", () => {
  const schema = z.toJSONSchema(getGetTasksBaseSchema(), { target: "draft-7" });
  assert.ok(schema.properties.ticket_number.anyOf);
});
