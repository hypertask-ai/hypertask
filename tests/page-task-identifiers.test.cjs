const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(root, "tests/page-task-identifiers-entry.cjs"),
  { interopDefault: true, cache: false }
);
const { CreatePageInputSchema, ListPagesInputSchema } = jiti(
  path.join(root, "src/lib/mcp-server/validations/page.validation.ts")
);

const createRoute = readSource("src/app/api/mcp/pages/create/route.ts");
const listRoute = readSource("src/app/api/mcp/pages/list/route.ts");
const pageValidation = readSource(
  "src/lib/mcp-server/validations/page.validation.ts"
);
const pageService = readSource(
  "src/lib/mcp-server/lib/services/page.service.ts"
);

test("pages create resolves ticket_number through the shared task resolver", () => {
  const parsed = CreatePageInputSchema.parse({
    ticket_number: "HTPR-5132",
    content: "Ticket page",
  });
  assert.equal(parsed.ticket_number, "HTPR-5132");
  assert.match(createRoute, /ticket_number\?: unknown/);
  assert.match(createRoute, /ticket_number: ticketNumber/);
  assert.match(pageValidation, /createTaskIdentificationBaseSchema\(\)/);
});

test("pages create resolves unique_index with project_id", () => {
  const parsed = CreatePageInputSchema.parse({
    unique_index: 5132,
    project_id: 15,
    content: "Indexed page",
  });
  assert.equal(parsed.unique_index, 5132);
  assert.equal(parsed.project_id, 15);
  assert.match(createRoute, /unique_index: uniqueIndex/);
  assert.match(createRoute, /project_id: projectId/);
  assert.match(
    pageValidation,
    /data\.unique_index === undefined \|\| data\.project_id !== undefined/
  );
});

test("pages create still resolves a raw task_id", () => {
  const parsed = CreatePageInputSchema.parse({
    task_id: 20706,
    content: "Task page",
  });
  assert.equal(parsed.task_id, 20706);
  assert.match(createRoute, /task_id: taskId/);
  assert.match(createRoute, /validateTaskIdentifier\(identifier\)/);
  assert.match(
    createRoute,
    /findTaskByIdentifier\(\s*ctx\.user,\s*identifier,\s*ctx\.agentId\s*\)/
  );
  assert.match(createRoute, /taskId: task\.id/);
});

test("pages create keeps the not-found or access-denied response", () => {
  assert.match(
    createRoute,
    /buildFieldError\('not_found', 'task_id', 'Task not found or access denied'\)/
  );
  assert.match(
    createRoute,
    /!task \|\| !\(await canAccessProject\(task\.projectId, ctx\)\)/
  );
});

test("ambiguous ticket numbers ask for project_id instead of returning 500", () => {
  assert.match(createRoute, /error instanceof TaskIdentifierAmbiguityError/);
  assert.match(
    createRoute,
    /buildFieldError\('invalid_field', 'ticket_number', error\.message\)/
  );
  assert.match(listRoute, /error instanceof TaskIdentifierAmbiguityError/);
  assert.match(
    listRoute,
    /Ticket number is ambiguous across accessible projects; use task_id or \(project_id \+ unique_index\)/
  );
});

// project_id remains a project-list selector unless unique_index makes it a
// task qualifier. The route, MCP schema, and thin service must agree.
test("pages list keeps exactly one task-or-project target under the project_id rule", () => {
  for (const input of [
    { task_id: 20706 },
    { ticket_number: "HTPR-5132" },
    { unique_index: 5132, project_id: 15 },
    { project_id: 15 },
  ]) {
    assert.equal(ListPagesInputSchema.safeParse(input).success, true);
  }
  for (const input of [
    {},
    { unique_index: 5132 },
    { task_id: 20706, project_id: 15 },
    { ticket_number: "HTPR-5132", project_id: 15 },
    { task_id: 20706, ticket_number: "HTPR-5132" },
  ]) {
    assert.equal(ListPagesInputSchema.safeParse(input).success, false);
  }
  assert.match(
    listRoute,
    /rawProjectId !== null && rawUniqueIndex === null/
  );
  assert.match(
    listRoute,
    /if \(hasTaskIdentifier && hasProjectIdentifier\)/
  );
  assert.match(
    listRoute,
    /if \(!hasTaskIdentifier && !hasProjectIdentifier\)/
  );
  assert.match(
    pageValidation,
    /data\.project_id !== undefined && data\.unique_index === undefined/
  );
  assert.match(pageValidation, /return hasTaskIdentifier !== hasProjectIdentifier/);
  assert.match(
    pageService,
    /queryParams\.set\('ticket_number', validatedInput\.ticket_number\)/
  );
  assert.match(
    pageService,
    /queryParams\.set\('unique_index', String\(validatedInput\.unique_index\)\)/
  );
});
