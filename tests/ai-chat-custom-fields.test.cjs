// HTPR-3805: the in-app AI chat needs custom-field tools so a user can say
// "set ICE to 21 on THID-5" or "list this board's custom fields". No DB test
// harness exists in this repo (see custom-field-owner-access.test.cjs for the
// same source-inspection convention), so this guards the wiring at the source
// level rather than exercising the route against a live database.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROUTE = path.resolve(
  __dirname,
  "../src/app/api/ai/chat/stream/route.ts",
);

function toolBody(source, toolName) {
  const start = source.indexOf(`${toolName}: tool({`);
  assert.notEqual(start, -1, `${toolName} tool definition not found`);
  const nextToolStart = source.indexOf("\n    hypertask_", start + 1);
  return source.slice(start, nextToolStart === -1 ? undefined : nextToolStart);
}

test("hypertask_list_custom_fields scopes to boards the user can access", () => {
  const source = fs.readFileSync(ROUTE, "utf8");
  const body = toolBody(source, "hypertask_list_custom_fields");

  // Same owner-OR-member predicate as every sibling project-scoped tool
  // (e.g. hypertask_list_project_members), not a bare Member lookup.
  assert.match(
    body,
    /validateProjectAccess\(input\.project_id, user\.id\)/,
    "must gate access with validateProjectAccess (getProjectWhere), matching sibling project-scoped tools",
  );
  assert.match(
    body,
    /getCustomFieldsForProject\(input\.project_id\)/,
    "must reuse the shared customFields controller rather than a bespoke query",
  );
});

test("hypertask_set_custom_field_value resolves task refs and reuses the shared controllers", () => {
  const source = fs.readFileSync(ROUTE, "utf8");
  const body = toolBody(source, "hypertask_set_custom_field_value");

  // Task ref resolution (task_id/ticket_number/unique_index+project_id) goes
  // through the same resolver every sibling task-mutating tool uses, which
  // scopes to accessible projects via getProjectWhere internally.
  assert.match(
    body,
    /resolveTaskForTool\(user, \{/,
    "must resolve task refs via resolveTaskForTool, not a bespoke lookup",
  );

  // Auto-create + upsert must go through the same controllers the MCP route
  // uses (src/app/api/mcp/custom-fields/value/route.ts), so validation and
  // auto-create-on-missing-name behavior can't drift between clients.
  assert.match(body, /createCustomField\(/, "must reuse createCustomField for auto-create");
  assert.match(
    body,
    /upsertCustomFieldValue\(/,
    "must reuse upsertCustomFieldValue, not a bespoke prisma write",
  );

  // Validation errors (e.g. "Number custom field value must be a valid
  // number") must reach the model, not be swallowed. withToolErrors catches
  // the thrown CustomFieldValidationError and returns { success: false,
  // error: error.message } (see errorMessage()).
  assert.match(
    body,
    /execute: withToolErrors\(async \(input\) => \{/,
    "must wrap execute in withToolErrors so validation error messages reach the model",
  );
});

test("hypertask_set_custom_field_value is registered as a write tool", () => {
  const source = fs.readFileSync(ROUTE, "utf8");
  const writeToolNamesStart = source.indexOf("const writeToolNames = new Set([");
  const writeToolNamesEnd = source.indexOf("]);", writeToolNamesStart);
  const writeToolNames = source.slice(writeToolNamesStart, writeToolNamesEnd);

  assert.match(
    writeToolNames,
    /"hypertask_set_custom_field_value"/,
    "must be listed in writeToolNames so successful calls surface in the write-summary footer",
  );
});
