const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("global create defaults reject invalid scope and fall back from stale sections", () => {
  const route = read("src/pages/api/tasks/createGlobally.ts");

  assert.match(route, /const project_id = Number\(projectId\)/);
  assert.match(route, /taskWriteAccessWhere\(session\.userId, null\)/);
  assert.match(route, /id: requestedSectionId,[\s\S]*projectId: project_id/);
  assert.match(route, /requestedSection \?\?[\s\S]*ranking: "asc"/);
  assert.match(route, /status\(404\)\.json\(\{ message: "No active section found" \}\)/);
  assert.doesNotMatch(route, /throw "No section"/);
});

test("the create modal cancels stale default lookups and contains failures", () => {
  const hook = read(
    "src/hooks/MultiPages/Tasks/useCreateTaskModalStates.ts",
  );

  assert.match(hook, /sectionDefaultsRequestRef\.current\?\.abort\(\)/);
  assert.match(hook, /signal: controller\.signal/);
  assert.match(hook, /sectionDefaultsRequestRef\.current === controller/);
  assert.match(hook, /if \(!axios\.isCancel\(error\)\)/);
});
