const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("view routes reject string booleans instead of coercing them", () => {
  const createRoute = read("src/app/api/mcp/view/route.ts");
  const updateRoute = read("src/app/api/mcp/view/[viewId]/route.ts");

  for (const source of [createRoute, updateRoute]) {
    assert.match(
      source,
      /body\.set_as_default !== undefined && typeof body\.set_as_default !== 'boolean'/,
    );
    assert.doesNotMatch(source, /Boolean\(body\.set_as_default\)/);
  }
});

test("view reads and mutations return one subtask setting field name", () => {
  const detailRoute = read("src/app/api/mcp/view/[viewId]/route.ts");
  const service = read("src/lib/mcp/views/services.ts");

  assert.match(detailRoute, /board_subtask_setting: v\.board_subtask_setting/);
  assert.equal(
    (service.match(/board_subtask_setting: (?:view|updated)\.board_subtask_setting/g) ?? [])
      .length,
    2,
  );
  assert.doesNotMatch(
    service,
    /\n\s+subtask_setting: (?:view|updated)\.board_subtask_setting/,
  );
});

test("project view listing can return one complete native cache snapshot", () => {
  const listRoute = read("src/app/api/mcp/view/route.ts");

  assert.match(listRoute, /searchParams\.get\('include_settings'\) === 'true'/);
  assert.match(listRoute, /select: \{ appliedViewId: true \}/);
  assert.match(listRoute, /item\.is_applied = appliedViewId === v\.id/);
  assert.match(listRoute, /item\.board_filters = sanitizeBoardFilters\(v\.board_filters\)/);
  assert.match(listRoute, /item\.board_sorting_stack = v\.board_sorting_stack/);
});

test("inbox listing exposes canonical compact split membership", () => {
  const inboxRoute = read("src/app/api/mcp/inbox/list/route.ts");

  assert.match(inboxRoute, /user_structured_data: json\.structuredData/);
  assert.match(inboxRoute, /agent_structured_data: agentInbox\.structuredData/);
  assert.match(inboxRoute, /structuredData,/);
  assert.doesNotMatch(inboxRoute, /\/\/ structuredData/);
});
