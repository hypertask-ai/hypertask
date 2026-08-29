const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const includesSource = read(
  "src/utils/controllers/projects/getAllIncludes.ts"
);
const getAllSource = read("src/utils/controllers/projects/getAll.ts");
const getAllRouteSource = read("src/pages/api/projects/getAll.ts");
const boardTasksSource = read(
  "src/utils/controllers/projects/getBoardTasks.ts"
);
const clientSource = read("src/utils/api/Homepage/index.ts");
const landingSource = read("src/app/[...boardURL]/LandingPage.tsx");
const schemaSource = read("src/prisma/schema.prisma");
const boardTaskTagsSource = read(
  "src/components/PageComponents/Kanban/KanbanTaskComponents/TaskTagsRow.tsx"
);
const tableTaskTitleSource = read(
  "src/components/Common/TaskRowComponents/TaskTitle.tsx"
);

test("inactive board bootstrap records exclude feature-heavy relations", () => {
  const select = includesSource.slice(
    includesSource.indexOf("export const projectBootstrapSelect"),
    includesSource.indexOf("export const getProjectIncludeWithoutTasks")
  );

  assert.match(select, /id: true/);
  assert.match(select, /title: true/);
  assert.match(select, /section: \{/);
  assert.doesNotMatch(select, /members:/);
  assert.doesNotMatch(select, /team:/);
  assert.doesNotMatch(select, /project_view:/);
  assert.doesNotMatch(select, /ai_custom_instructions:/);
});

test("getAll leaves active-board metadata to the parallel board payload", () => {
  assert.match(getAllRouteSource, /req\.body\?\.projectId/);
  assert.match(getAllSource, /select: projectBootstrapSelect/);
  assert.doesNotMatch(getAllSource, /prisma\.project\.findFirst/);
  assert.doesNotMatch(getAllSource, /activeProject\?\.id/);
  assert.match(
    getAllSource,
    /hasActiveProject\s*\? prisma\.project\.findMany\([\s\S]*?select: projectBootstrapSelect[\s\S]*?: prisma\.project\.findMany\([\s\S]*?include: getProjectIncludeWithoutTasks/,
    "callers without an active board must retain the legacy full payload during rollout"
  );
});

test("on-demand board payload restores full metadata before hydration", () => {
  assert.match(boardTasksSource, /const \{ allViews = \[\], \.\.\.projectView \}/);
  assert.match(boardTasksSource, /project: projectPayload/);
  assert.doesNotMatch(boardTasksSource, /project: sanitizedProject,/);
  assert.match(clientSource, /project: res\.data\?\.project/);
  assert.match(clientSource, /\{ \.\.\.project, \.\.\.payload\.project \}/);
  assert.match(
    landingSource,
    /isBoardPayloadHydrated\(data\.updatedProjects\[projectIndex\]\)/
  );
  assert.match(landingSource, /failedAttempts <= 2/);
  assert.match(landingSource, /setHydrationRetryToken/);
  assert.match(landingSource, /Couldn&apos;t load this board\./);
  assert.match(
    landingSource,
    /Failed to load board data on switch[\s\S]*?return null/,
    "a failed switch must retain the current hydrated board"
  );
  assert.match(
    clientSource,
    /\["boardTasks", userId, projectId\]/,
    "user-scoped board metadata must not be reused across accounts"
  );
});

test("Board/Table uses the narrow relation and scalar projection", () => {
  const boardInclude = includesSource.slice(
    includesSource.indexOf("export const getBoardTaskInclude"),
    includesSource.indexOf("export const getProjectViewBaseInclude"),
  );
  const boardOmit = includesSource.slice(
    includesSource.indexOf("export const taskBoardOmit"),
    includesSource.indexOf("export const getFullProjectInclude"),
  );

  for (const field of ["id", "userId", "agentId", "displayName", "photoURL"]) {
    assert.match(boardInclude, new RegExp(`${field}: true`));
  }
  for (const field of ["assignerId", "agentAssignerId", "assignedAt"]) {
    assert.doesNotMatch(boardInclude, new RegExp(`${field}: true`));
  }
  assert.match(boardInclude, /taskLabels:[\s\S]*?label:[\s\S]*?value: true/);
  assert.match(
    boardInclude,
    /notifications:[\s\S]*?taskId: true,[\s\S]*?type: true,[\s\S]*?seen: true/,
  );
  for (const field of [
    "description",
    "descriptionJson",
    "staleNudgedAt",
    "dueDateNotifiedAt",
    "permanentlyDeleteAt",
    "hardDeleteProcessingAt",
    "deletedAt",
    "archivedAt",
  ]) {
    assert.match(boardOmit, new RegExp(`${field}: true`));
  }
});

test("Board/Table label projection keeps every rendered label field", () => {
  const labelModel = schemaSource.slice(
    schemaSource.indexOf("model Label {"),
    schemaSource.indexOf("model SubscriptionPlan"),
  );
  const boardInclude = includesSource.slice(
    includesSource.indexOf("export const getBoardTaskInclude"),
    includesSource.indexOf("export const getProjectViewBaseInclude"),
  );
  const labelSelect = boardInclude.slice(
    boardInclude.indexOf("taskLabels:"),
    boardInclude.indexOf("notifications:"),
  );
  const renderers = `${boardTaskTagsSource}\n${tableTaskTitleSource}`;

  assert.match(labelModel, /id\s+String/);
  assert.match(labelModel, /value\s+String\?/);
  assert.doesNotMatch(labelModel, /\bcolor\b/);
  assert.match(renderers, /label\?\.value/);
  assert.doesNotMatch(renderers, /label\?\.color|label\.color/);
  assert.match(labelSelect, /id: true/);
  assert.match(labelSelect, /value: true/);
  for (const unusedField of ["createdAt", "ai_prompt", "projectId", "task"])
    assert.doesNotMatch(labelSelect, new RegExp(`${unusedField}: true`));
});
