const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/native-current-tasks-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const { buildCurrentTaskReport } = jiti(
  path.join(root, "src/lib/nativeReports/currentTasks.ts")
);

test("current task report keeps board section order and includes empty sections", () => {
  const report = buildCurrentTaskReport({
    total: 5,
    sections: [
      { id: 2, title: "Done", ranking: "A0300" },
      { id: 1, title: "In progress", ranking: "A0200" },
      { id: 3, title: "Inbox", ranking: "A0100" },
    ],
    sectionCounts: [
      { sectionId: 1, section: "In progress", count: 3 },
      { sectionId: 2, section: "Done", count: 2 },
    ],
    assigneeCounts: [],
    unassignedCount: 5,
    generatedAt: new Date("2026-09-19T12:30:00.000Z"),
  });

  assert.deepEqual(report.sections, [
    { key: "section:3", label: "Inbox", value: 0 },
    { key: "section:1", label: "In progress", value: 3 },
    { key: "section:2", label: "Done", value: 2 },
  ]);
  assert.deepEqual(report.assignees, [
    { key: "unassigned", label: "Unassigned", value: 5 },
  ]);
  assert.equal(report.generatedAt, "2026-09-19T12:30:00.000Z");
});

test("current task report sorts assignees and preserves tasks in removed sections", () => {
  const report = buildCurrentTaskReport({
    total: 7,
    sections: [{ id: 1, title: "Doing", ranking: "A0100" }],
    sectionCounts: [
      { sectionId: 1, section: "Doing", count: 4 },
      { sectionId: null, section: "Old column", count: 3 },
    ],
    assigneeCounts: [
      { key: "user:2", label: "Zara", count: 2 },
      { key: "agent:a", label: "Build bot", count: 4 },
      { key: "user:1", label: "Alex", count: 2 },
    ],
    unassignedCount: 1,
    generatedAt: new Date("2026-09-19T12:30:00.000Z"),
  });

  assert.deepEqual(report.sections, [
    { key: "section:1", label: "Doing", value: 4 },
    { key: "legacy:Old column", label: "Old column", value: 3 },
  ]);
  assert.deepEqual(report.assignees, [
    { key: "agent:a", label: "Build bot", value: 4 },
    { key: "user:1", label: "Alex", value: 2 },
    { key: "user:2", label: "Zara", value: 2 },
    { key: "unassigned", label: "Unassigned", value: 1 },
  ]);
});
