import assert from "node:assert/strict";
import test from "node:test";
import { getManageColumnRows } from "../src/components/Modals/commands/manageColumnTaskCounts";

test("manage columns shows each column's full task count, including zero", () => {
  const sections = [
    { id: 10, section_title: "Backlog" },
    { id: 20, section_title: "In Progress" },
    { id: 30, section_title: "Done" },
  ];
  const tasks = [
    { id: 1, sectionId: 10 },
    { id: 2, sectionId: 10 },
    { id: 3, sectionId: 20 },
  ];

  const rows = getManageColumnRows(sections, tasks);

  assert.deepEqual(
    rows.map(({ section, taskCount }) => [section.section_title, taskCount]),
    [
      ["Backlog", 2],
      ["In Progress", 1],
      ["Done", 0],
    ],
  );
});

test("manage columns ignores tasks without a section", () => {
  const rows = getManageColumnRows(
    [{ sectionId: 10, section_title: "Backlog" }],
    [{ id: 1, sectionId: 10 }, { id: 2 }],
  );

  assert.equal(rows[0]?.taskCount, 1);
});
