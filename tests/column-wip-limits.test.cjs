const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");
const { getManageColumnRows } = load("src/components/Modals/commands/manageColumnTaskCounts.ts", {});
const views = load("src/utils/helperFunctions/Views/ViewsHelperFunctions.ts", {
  "@/lib/firstScreen/boardView": {},
  "@/utils/helperFunctions/helperFunctions": {},
  "./FilterHelperFunctions": {},
  "./TableColumnsHelperFunctions": {},
  "./SubtaskHelperFunction": {},
  "./EmptySectionsHelperFunction": {},
});
const { getActiveColumnsViewFromProject } = views;
const { getCurrentProject } = load("src/utils/helperFunctions/helperFunctions.ts", {
  "./Views/ViewsHelperFunctions": views,
  "./inboxHelpers": {},
  "@/lib/media/heicToJpeg": {},
});

function fixture({ allowed = true, enabled = true } = {}) {
  const section = { id: 11, projectId: 15, section_title: "In Progress", ranking: "A1", visibility: true, deleted: false, isDone: false, wipLimit: 3, autoAssignUserId: null, autoAssignAgentId: null };
  const writes = [];
  const prisma = {
    section: {
      findUnique: async () => ({ ...section }),
      findFirst: async () => allowed ? { ...section } : null,
      update: async ({ data }) => { writes.push(data); Object.assign(section, data); return { ...section }; },
    },
    project: { findFirst: async () => allowed ? { id: 15 } : null },
  };
  prisma.$transaction = async (run) => run(prisma);
  const mocks = {
    "@/lib/prisma": { default: prisma },
    "@/lib/flags": { isFeatureEnabled: async () => enabled },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
    "@/utils/controllers/notifications/agentFirstTaskEmail": {},
    "@/lib/telemetry/activationOccurrences": {},
    "@/lib/telemetry/savedWork": { enqueueColumnRenamed: async () => null },
    "./viewHelpers": { updateSectionInAllViews: async () => {} },
  };
  const update = load("src/utils/controllers/section/update.ts", mocks).default;
  return { section, writes, update: (newSection) => update(985, 11, newSection) };
}

test("column limits save, clear, and survive unrelated edits through the shared controller", async () => {
  const f = fixture();
  const saved = await f.update({ wipLimit: 2 });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.wipLimit, 2);
  const reordered = await f.update({ ranking: "A2" });
  assert.equal(reordered.status, 200);
  assert.equal(f.section.wipLimit, 2);
  const cleared = await f.update({ wipLimit: null });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.json.wipLimit, null);
});

test("invalid column limits cannot reach storage", async () => {
  const f = fixture();
  for (const wipLimit of [0, -1, 1.5, "3", true, 2147483648]) {
    assert.equal((await f.update({ wipLimit })).status, 400, String(wipLimit));
  }
  assert.deepEqual(f.writes, []);
});

test("column limits retain board permission checks", async () => {
  const denied = fixture({ allowed: false });
  assert.equal((await denied.update({ wipLimit: 2 })).status, 403);
  assert.deepEqual(denied.writes, []);
  assert.equal((await fixture().update({ wipLimit: 2 })).status, 200);
});

test("limits count all active work, exclude archive and trash, and warn only above the limit", () => {
  const sections = [{ id: 11, wipLimit: 2 }, { id: 12, wipLimit: null }, { id: 13, wipLimit: 1 }];
  const tasks = [
    { id: 1, sectionId: 11, status: "Normal" },
    { id: 2, sectionId: 11 },
    { id: 3, sectionId: 11, status: "Archive" },
    { id: 4, sectionId: 11, status: "Deleted" },
    { id: 5, sectionId: 12 },
  ];
  assert.deepEqual(getManageColumnRows(sections, tasks).map(({ taskCount, overLimit }) => [taskCount, overLimit]), [[2, false], [1, false], [0, false]]);
  tasks.push({ id: 6, sectionId: 11, status: "Normal" });
  assert.equal(getManageColumnRows(sections, tasks)[0].overLimit, true);
});

test("saved, private and unsaved views use canonical limits instead of stale snapshots", () => {
  for (const viewKey of ["default_view", "appliedView", "unsavedView"]) {
    const columns = [{ id: 11, wipLimit: 99, visibility: false }];
    const project = {
      section: [{ id: 11, section_title: "In Progress", ranking: "A1", wipLimit: 2 }],
      project_view: viewKey === "default_view"
        ? { default_view: { board_columns_view: columns } }
        : { user_project_views: [{ [viewKey]: { board_columns_view: columns } }] },
    };
    assert.equal(getActiveColumnsViewFromProject(project)[0].wipLimit, 2);
    assert.equal(getActiveColumnsViewFromProject(project)[0].visibility, false);
    project.section[0].wipLimit = null;
    assert.equal(getActiveColumnsViewFromProject(project)[0].wipLimit, null);
  }
});

test("the rendered board sections retain limits through task grouping", () => {
  const result = getCurrentProject({
    section: [{ id: 11, section_title: "In Progress", visibility: true, ranking: "A1", wipLimit: 2 }],
    tasks: [{ id: 1, sectionId: 11, ranking: "A1" }],
  });
  assert.equal(result._sections[0].wipLimit, 2);
  assert.equal(result._sections[0].items.length, 1);
});

test("flag Off refuses limit writes without blocking ordinary column edits", async () => {
  const f = fixture({ enabled: false });
  assert.equal((await f.update({ wipLimit: 2 })).status, 403);
  assert.deepEqual(f.writes, []);
  assert.equal((await f.update({ ranking: "A2" })).status, 200);
  assert.equal(f.section.wipLimit, 3);
});
