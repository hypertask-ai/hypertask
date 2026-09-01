const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("board planning exposes the optional fixed two-week cycle setting", () => {
  const source = read("src/components/Modals/Settings/BoardPlanningSection.tsx");
  assert.match(source, /<SettingsCard title="Cycles">/);
  assert.match(source, /<SettingsToggle/);
  assert.match(source, /action: "set_cycles"/);
  assert.match(source, />2 weeks</);
  assert.match(source, />Current starts</);
  assert.match(source, />Next cycle</);
});

test("cycle views are tabs on the existing board and render cycle metadata", () => {
  const views = read("src/lib/constants/builtinViews.ts");
  const landing = read("src/app/[...boardURL]/LandingPage.tsx");
  const meta = read(
    "src/components/PageComponents/Kanban/HeaderComponents/CycleBoardMeta.tsx",
  );
  assert.match(views, /title: "Current cycle"/);
  assert.match(views, /title: "Next cycle"/);
  assert.match(landing, /<CycleBoardMeta/);
  assert.match(meta, /Cycle \{cycle\.number\}/);
  assert.match(meta, /cycleDateRange\(cycle\)/);
  assert.match(meta, /cycleDaysLeft\(cycle\)/);
});

test("task detail uses a searchable shadow cycle picker with read-only history", () => {
  const taskInfo = read(
    "src/components/PageComponents/TaskDetail/TaskInfoColumn/TaskInfo.tsx",
  );
  const picker = read("src/components/Modals/CyclePicker/index.tsx");
  assert.match(taskInfo, /title="Cycle"/);
  assert.match(taskInfo, /<CyclePicker/);
  assert.match(picker, /placeholder="Search cycles"/);
  assert.match(picker, /shadow-xl/);
  assert.match(picker, /cycle\.assignable \? "" : " · history"/);
  assert.match(picker, /if \(saving \|\| \(cycle && !cycle\.assignable\)\) return/);
});

test("database and cross-board move paths enforce same-board cycle assignment", () => {
  const schema = read("src/prisma/schema.prisma");
  const migration = read(
    "src/prisma/migrations/20260901110000_add_board_cycles/migration.sql",
  );
  const move = read("src/utils/controllers/tasks/moveToDifferentBoard.ts");
  assert.match(
    schema,
    /@relation\(fields: \[projectId, cycleId\], references: \[projectId, id\]\)/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("projectId", "cycleId"\) REFERENCES "Cycle"\("projectId", "id"\)/,
  );
  assert.match(move, /cycleId: null/);
});
