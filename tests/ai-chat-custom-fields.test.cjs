const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("./helpers/chat-stream-source.cjs");
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

  assert.match(
    body,
    /resolveTaskForTool\(user, \{/,
    "must resolve task refs via resolveTaskForTool, not a bespoke lookup",
  );

  assert.match(body, /createCustomField\(/, "must reuse createCustomField for auto-create");
  assert.match(
    body,
    /upsertCustomFieldValue\(/,
    "must reuse upsertCustomFieldValue, not a bespoke prisma write",
  );

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
