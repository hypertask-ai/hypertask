const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const sectionSource = readFileSync(
  path.join(
    process.cwd(),
    "src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx",
  ),
  "utf8",
);
const titleStart = sectionSource.indexOf("const TitleAndTasks =");
const titleEnd = sectionSource.indexOf("const DragoverOverlay", titleStart);
const titleComponent = sectionSource.slice(titleStart, titleEnd);

test("tapping a board column title opens Manage columns on mobile and desktop", () => {
  assert.match(
    titleComponent,
    /onClick={toggleOnManageColumnsModal}/,
    "the rendered column title must keep the Manage columns click handler",
  );
  assert.match(
    titleComponent,
    /setShowCommands\(\{\s*show:\s*true,\s*mode:\s*CommandMode\.ManageColumn\s*\}\)/,
    "the click handler must open the existing Manage columns command",
  );
  assert.doesNotMatch(
    titleComponent,
    /if\s*\(isMbl\)\s*return/,
    "mobile taps must not exit before opening Manage columns",
  );
});
