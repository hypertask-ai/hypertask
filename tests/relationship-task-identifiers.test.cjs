const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(root, "tests/relationship-task-identifiers-entry.cjs"),
  { interopDefault: true, cache: false }
);
const {
  FindRelatedTasksInputSchema,
  LinkTasksInputSchema,
} = jiti(
  path.join(root, "src/lib/mcp-server/validations/task.validation.ts")
);

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function methodSource(source, method, nextMethod) {
  const start = source.indexOf(`export async function ${method}`);
  const end = nextMethod
    ? source.indexOf(`export async function ${nextMethod}`, start)
    : source.length;
  return source.slice(start, end);
}

const relationsRoute = readSource(
  "src/app/api/mcp/tasks/relations/route.ts"
);
const relationsPost = methodSource(relationsRoute, "POST", "GET");
const relationsGet = methodSource(relationsRoute, "GET", "DELETE");
const relationsDelete = methodSource(relationsRoute, "DELETE");
const relatedRoute = readSource("src/app/api/mcp/tasks/related/route.ts");
const relatedGet = methodSource(relatedRoute, "GET", "POST");
const relatedPost = methodSource(relatedRoute, "POST");
const taskService = readSource(
  "src/lib/mcp-server/lib/services/task.service.ts"
);
const relatedService = readSource(
  "src/lib/mcp-server/lib/services/related-tasks.service.ts"
);
const toolMetadata = readSource(
  "src/lib/mcp-server/config/tool-metadata.ts"
);

test("relations GET accepts every shared task identifier", () => {
  for (const input of [
    { action: "list", task_id: 20706 },
    { action: "list", ticket_number: "HTPR-5159" },
    { action: "list", unique_index: 5159, project_id: 15 },
  ]) {
    assert.equal(LinkTasksInputSchema.safeParse(input).success, true);
  }

  assert.match(relationsGet, /unique_index: uniqueIndex/);
  assert.match(relationsGet, /validateTaskIdentifier\(identifier\)/);
  assert.match(
    relationsGet,
    /findTaskByIdentifier\(ctx\.user, identifier, ctx\.agentId\)/
  );
  assert.match(
    taskService,
    /queryParams\.set\('unique_index', String\(validatedInput\.unique_index\)\)/
  );
});

test("relations POST and DELETE accept independent source identifier trios", () => {
  for (const action of ["link", "unlink"]) {
    const relationType = action === "link" ? { relation_type: "RelatedTo" } : {};
    for (const source of [
      { source_task_id: 20706 },
      { source_ticket_number: "HTPR-5159" },
      { source_unique_index: 5159, source_project_id: 15 },
    ]) {
      const parsed = LinkTasksInputSchema.safeParse({
        action,
        ...source,
        target_task_id: 20707,
        ...relationType,
      });
      assert.equal(parsed.success, true);
    }
  }

  for (const route of [relationsPost, relationsDelete]) {
    assert.match(route, /source_unique_index/);
    assert.match(route, /source_project_id/);
    assert.match(route, /validateTaskIdentifier\(sourceIdentifier\)/);
    assert.match(
      route,
      /findTaskByIdentifier\(\s*ctx\.user,\s*sourceIdentifier,\s*ctx\.agentId\s*\)/
    );
  }
});

test("relations POST and DELETE accept independent target identifier trios", () => {
  for (const action of ["link", "unlink"]) {
    const relationType = action === "link" ? { relation_type: "BlockedBy" } : {};
    for (const target of [
      { target_task_id: 20707 },
      { target_ticket_number: "HTPR-5160" },
      { target_unique_index: 5160, target_project_id: 15 },
    ]) {
      const parsed = LinkTasksInputSchema.safeParse({
        action,
        source_task_id: 20706,
        ...target,
        ...relationType,
      });
      assert.equal(parsed.success, true);
    }
  }

  for (const route of [relationsPost, relationsDelete]) {
    assert.match(route, /target_unique_index/);
    assert.match(route, /target_project_id/);
    assert.match(route, /validateTaskIdentifier\(targetIdentifier\)/);
    assert.match(
      route,
      /findTaskByIdentifier\(\s*ctx\.user,\s*targetIdentifier,\s*ctx\.agentId\s*\)/
    );
  }
});

test("relations preserves shared project_id and not-found/access-denied errors", () => {
  const sharedProject = LinkTasksInputSchema.safeParse({
    source_unique_index: 5159,
    target_unique_index: 5160,
    project_id: 15,
    relation_type: "RelatedTo",
  });
  assert.equal(sharedProject.success, true);

  for (const route of [relationsPost, relationsGet, relationsDelete]) {
    assert.match(route, /Task not found or access denied/);
    assert.match(route, /status: 404/);
  }
});

test("relations ambiguity responses are 400s naming the exact endpoint field", () => {
  assert.match(relationsGet, /ticket_number: \$\{error\.message\}/);
  for (const route of [relationsPost, relationsDelete]) {
    assert.match(route, /source_ticket_number: \$\{error\.message\}/);
    assert.match(route, /target_ticket_number: \$\{error\.message\}/);
  }
  assert.ok(
    (relationsRoute.match(/error instanceof TaskIdentifierAmbiguityError/g) || [])
      .length >= 5
  );
});

test("related GET and POST accept all task identifiers while POST keeps text search", () => {
  for (const input of [
    { task_id: 20706 },
    { ticket_number: "HTPR-5159" },
    { unique_index: 5159, project_id: 15 },
    { text: "prior art" },
  ]) {
    assert.equal(FindRelatedTasksInputSchema.safeParse(input).success, true);
  }

  for (const route of [relatedGet, relatedPost]) {
    assert.match(route, /validateTaskIdentifier\(identifier\)/);
    assert.match(
      route,
      /findTaskByIdentifier\(ctx\.user, identifier, ctx\.agentId\)/
    );
    assert.match(route, /Task not found or access denied/);
    assert.match(route, /status: 404/);
    assert.match(route, /ticket_number: \$\{error\.message\}/);
  }
  assert.match(relatedPost, /return handleRelatedTasksPost\(request, ctx, body\)/);
});

test("related service and tool metadata teach agents every identifier form", () => {
  assert.match(
    relatedService,
    /queryParams\.set\('ticket_number', validatedInput\.ticket_number\)/
  );
  assert.match(
    relatedService,
    /queryParams\.set\('unique_index', String\(validatedInput\.unique_index\)\)/
  );
  assert.match(toolMetadata, /Identify an existing task by task_id, ticket_number, or project_id \+ unique_index/);
  assert.match(toolMetadata, /source and target fields use their respective prefixes/);
});

test("identifier schemas reject missing, mixed, and unqualified unique indexes", () => {
  for (const input of [
    {},
    { task_id: 20706, ticket_number: "HTPR-5159" },
    { unique_index: 5159 },
    { text: "prior art", project_id: 15 },
  ]) {
    assert.equal(FindRelatedTasksInputSchema.safeParse(input).success, false);
  }

  for (const input of [
    { action: "list", unique_index: 5159 },
    {
      source_unique_index: 5159,
      target_task_id: 20707,
      relation_type: "RelatedTo",
    },
    {
      source_task_id: 20706,
      target_unique_index: 5160,
      relation_type: "RelatedTo",
    },
  ]) {
    assert.equal(LinkTasksInputSchema.safeParse(input).success, false);
  }
});
