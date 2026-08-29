const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const jitiModule = require("jiti");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const jiti = jitiModule.createJiti
  ? jitiModule.createJiti(__filename, {
      interopDefault: true,
      moduleCache: false,
    })
  : jitiModule(__filename, { interopDefault: true, cache: false });
const {
  isCalendarViewVisibleToViewer,
  materializeCalendarViewProjectIds,
} = jiti(
  path.join(root, "src/models/Calendar/visibility.ts")
);
const { isCalendarViewCreateInput } = jiti(
  path.join(root, "src/models/Calendar/model.ts")
);

const validViewInput = {
  title: "Release calendar",
  visibility: "Public",
  projectIds: [10],
  taskFilters: {
    assignedToMe: false,
    updatedBy: [],
    createdBy: [],
    priority: [],
    assignees: [],
    assigneeAgents: [],
    updatedByAgents: [],
    labels: [],
    size: [],
    matchFilters: "ANY",
  },
  settings: { weekStartsOn: "monday", showWeekends: false, view: "week" },
  sort: null,
};

test("materializes all visible boards for a public view with no explicit selection", () => {
  assert.deepEqual(
    materializeCalendarViewProjectIds("Public", [], [10, 20, 30]),
    [10, 20, 30]
  );
  assert.deepEqual(
    materializeCalendarViewProjectIds("Private", [], [10, 20, 30]),
    []
  );
});

test("shows a public view when its boards are a strict subset of the viewer's boards", () => {
  assert.equal(
    isCalendarViewVisibleToViewer(
      { userId: 1, visibility: "Public", projectIds: [10, 20] },
      2,
      new Set([10, 20, 30])
    ),
    true
  );
});

test("hides a public view when it contains a board the viewer cannot access", () => {
  assert.equal(
    isCalendarViewVisibleToViewer(
      { userId: 1, visibility: "Public", projectIds: [10, 20, 40] },
      2,
      new Set([10, 20, 30])
    ),
    false
  );
});

test("hides an empty public view from non-owners", () => {
  assert.equal(
    isCalendarViewVisibleToViewer(
      { userId: 1, visibility: "Public", projectIds: [] },
      2,
      new Set([10, 20, 30])
    ),
    false
  );
});

test("rejects an empty public view at the input boundary", () => {
  assert.equal(
    isCalendarViewCreateInput({ ...validViewInput, projectIds: [] }),
    false
  );
  assert.equal(isCalendarViewCreateInput(validViewInput), true);
  assert.equal(
    isCalendarViewCreateInput({
      ...validViewInput,
      visibility: "Private",
      projectIds: [],
    }),
    true
  );
});

test("legacy migration clears only the preference snapshot it read", () => {
  const route = read("src/app/api/calendar/views/route.ts");
  assert.match(route, /userSetting\.updateMany\(\{/);
  assert.match(route, /equals: legacyPreference as Prisma\.InputJsonValue/);
});

test("new view creation reports a failed applied-pointer write", () => {
  const hook = read("src/hooks/Calendar/useCalendarView.ts");
  assert.match(
    hook,
    /const applied = await persistCalendarViews\([\s\S]*?return applied;/
  );
});
