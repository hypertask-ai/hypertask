const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const homepage = read(
  "src/components/PageComponents/Kanban/KanbanHomepageComponents/Homepage.tsx",
);
const section = read(
  "src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx",
);
const task = read(
  "src/components/PageComponents/Kanban/KanbanTaskComponents/task.tsx",
);

test("HTPR-6196: task cards use the project from their rendered board snapshot", () => {
  const renderSections = homepage.match(
    /const renderSections = \(archivedTasks\?: ITask\[\]\) =>[\s\S]*?\n\s*return \(/,
  )?.[0];
  assert.ok(renderSections);
  assert.match(renderSections, /<Section[\s\S]*project=\{_currentProject\}/);
  assert.doesNotMatch(homepage, /const renderSections = useCallback/);
  assert.match(section, /project: IProject;/);
  assert.match(section, /const currentProject = project;/);
  assert.doesNotMatch(section, /useRecoilValue\(currentProjectAtom\)/);
  assert.equal(section.match(/project=\{currentProject\}/g)?.length, 2);
});

test("HTPR-6196: task cards remain safe if a caller has no project", () => {
  assert.match(task, /project: IProject \| null;/);
  assert.match(task, /!project\?\.name/);
  assert.match(task, /showAssignModal && project\?\.name/);
});
