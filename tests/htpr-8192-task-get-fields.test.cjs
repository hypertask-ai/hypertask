const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { z } = require("zod");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  moduleCache: false,
  alias: { "@": path.join(root, "src") },
});
const { loadModule } = require("./helpers/loadModule.cjs");

const { getGetTasksBaseSchema, GetTaskInputSchema } = jiti(
  path.join(root, "src/lib/mcp-server/validations/task.validation.ts"),
);
const { actionableToolError } = jiti(
  path.join(root, "src/lib/mcp-server/tool-response.ts"),
);
const { TaskService } = loadModule("src/lib/mcp-server/lib/services/task.service.ts", {
  "@/lib/planLimits": { isPlanLimitReachedError: () => false, planLimitResponse: () => null },
});

const allowed = ["id", "task_id", "ticket_number", "unique_index", "project_id", "fields"];

test("task get accepts the same fields projection the task list accepts", () => {
  for (const schema of [getGetTasksBaseSchema(), GetTaskInputSchema]) {
    assert.equal(schema.parse({ ticket_number: "HTPR-8192", fields: "title,section" }).fields, "title,section");
    assert.deepEqual(schema.parse({ ticket_number: "HTPR-8192", fields: ["title", "section"] }).fields, ["title", "section"]);
  }
  const published = z.toJSONSchema(getGetTasksBaseSchema(), { target: "draft-7" });
  assert.equal(published.additionalProperties, false);
  assert.deepEqual(Object.keys(published.properties).sort(), [...allowed].sort());
});

test("task get names the field it refused", () => {
  const parsed = getGetTasksBaseSchema().safeParse({ ticket_number: "HTPR-8192", nope: true });
  assert.equal(parsed.success, false);
  assert.deepEqual(parsed.error.issues.find((issue) => issue.code === "unrecognized_keys").keys, ["nope"]);
  assert.match(actionableToolError(parsed.error), /Remove unsupported fields nope from input/);
});

test("task get sends the field list and leaves a projected read unchanged", async () => {
  const calls = [];
  const projected = { title: "A ticket", section: "In Progress" };
  const service = new TaskService({
    makeRequest: async (url) => {
      calls.push(url);
      return { success: true, tasks: [projected] };
    },
  });

  const result = await service.getTask({ ticket_number: "HTPR-8192", fields: ["title", "section"] });
  assert.equal(calls.length, 1);
  const query = new URL(calls[0], "https://api.hypertask.ai").searchParams;
  assert.equal(query.get("ticket_number"), "HTPR-8192");
  assert.equal(query.get("fields"), "title,section");
  assert.deepEqual(result.tasks, [projected]);
  assert.equal(result.tasks[0].link, undefined);
});

test("task get without fields still adds the ticket link", async () => {
  const service = new TaskService({
    makeRequest: async () => ({
      success: true,
      tasks: [{ id: 1, ticketNumber: "HTPR-8192", projectId: 15, title: "A ticket" }],
    }),
  });
  const result = await service.getTask({ ticket_number: "HTPR-8192" });
  assert.equal(result.tasks[0].link.url, "https://app.hypertask.ai/detail/project-15/8192");
});
