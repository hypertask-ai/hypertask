const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const jitiModule = require("jiti");

const root = path.join(__dirname, "..");
const jiti = jitiModule.createJiti
  ? jitiModule.createJiti(__filename, {
      interopDefault: true,
      moduleCache: false,
      alias: { "@": path.join(root, "src") },
    })
  : jitiModule(__filename, {
      interopDefault: true,
      cache: false,
      alias: { "@": path.join(root, "src") },
    });

const { openBlockingTasks } = jiti(
  path.join(root, "src/lib/blockingTasks.ts"),
);
const { getBoardTaskInclude } = jiti(
  path.join(root, "src/utils/controllers/projects/getAllIncludes.ts"),
);

const blocker = (id, overrides = {}) => ({
  id,
  projectId: 15,
  uniqueIndex: id,
  ticketNumber: `HTPR-${id}`,
  title: `Blocker ${id}`,
  status: "Normal",
  section: "In Progress",
  ...overrides,
});

test("open blocker summaries keep all active blockers and remove finished ones", () => {
  const relations = [
    { targetTask: blocker(1) },
    { targetTask: blocker(2, { section: "Quality Assured" }) },
    { targetTask: blocker(3, { status: "Archive" }) },
    { targetTask: blocker(4, { projectId: 22 }) },
  ];
  const doneTitlesByProject = new Map([
    [15, new Set(["quality assured"])],
    [22, new Set(["done"])],
  ]);

  assert.deepEqual(
    openBlockingTasks(relations, doneTitlesByProject).map(({ id }) => id),
    [1, 4],
  );
});

test("board blocker projection applies target-board access and selects only chip fields", () => {
  const relation = getBoardTaskInclude({
    userId: 6,
    userDbId: 6,
    currentUserId: 6,
  }).relatedFromTasks;

  assert.equal(relation.where.relationType, "BlockedBy");
  assert.ok(relation.where.targetTask.project.is.OR);
  assert.deepEqual(Object.keys(relation.select.targetTask.select).sort(), [
    "id",
    "projectId",
    "section",
    "status",
    "ticketNumber",
    "title",
    "uniqueIndex",
  ]);
});
