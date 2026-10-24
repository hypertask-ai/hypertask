process.env.FEATURE_FLAG_TYPESCRIPT_PATH = require.resolve("typescript");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const filename = "src/lib/flags/definitions/htpr-7725-saved-view-assignee.ts";
const source = fs.readFileSync(path.join(__dirname, "..", filename), "utf8");

test("saved-view human assignee bugfix defaults to Everyone", async () => {
  const { parseFlagFile } = await import("../.github/scripts/feature-flag-registry.mjs");
  const { definition } = parseFlagFile(source, filename);

  assert.equal(definition.key, "htpr-7725-saved-view-assignee");
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason.length > 0);
});

test("saved-view callers and tab counts explicitly opt into legacy matching only when the client flag is disabled", () => {
  for (const filename of [
    "src/app/[...boardURL]/useLandingSectionState.ts",
    "src/app/[...boardURL]/LandingPage.tsx",
    "src/hooks/Homepage/Views/useRenderedViews.ts",
    "src/hooks/Homepage/useHandleKeyDownOperations.ts",
    "src/hooks/MultiPages/useUpdateTaskInBoards.tsx",
    "src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx",
  ]) {
    const caller = fs.readFileSync(path.join(__dirname, "..", filename), "utf8");
    assert.match(caller, /assigneeFixEnabled = useFlag\(HTPR_7725_SAVED_VIEW_ASSIGNEE_FLAG\)/, filename);
    assert.match(caller, /legacyAgentAssigneeMatch: !assigneeFixEnabled/, filename);
    assert.doesNotMatch(caller, /humanAssigneesOnly/, filename);
  }
  const counts = fs.readFileSync(path.join(__dirname, "..", "src/hooks/Homepage/Views/useRenderedViews.ts"), "utf8");
  assert.match(counts, /applyFilters\([\s\S]*?filterRuntimeContext,/);
  assert.match(counts, /filteredSections\.reduce\(/);
});

test("calendar human assignee matching separates agent rows under the same client flag", () => {
  const caller = fs.readFileSync(path.join(__dirname, "..", "src/hooks/Calendar/useCalendarView.ts"), "utf8");
  assert.match(caller, /assigneeFixEnabled = useFlag\(HTPR_7725_SAVED_VIEW_ASSIGNEE_FLAG\)/);
  assert.match(caller, /\(!assigneeFixEnabled \|\| assignee\.agentId == null\) && assignees\.has\(assignee\.userId\)/);
});

test("anonymous shared boards load the scalar assignment IDs required for default filtering", () => {
  const caller = fs.readFileSync(path.join(__dirname, "..", "src/utils/controllers/share/getProject.ts"), "utf8");
  assert.match(caller, /assignees: \{\s*select: \{\s*userId: true,\s*agentId: true,/);
  assert.match(caller, /getFilteredSections\(_sections, projectAsIProject\)/);
});
