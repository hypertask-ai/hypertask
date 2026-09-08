// HTPR-6312. My Tasks had no filters; the board filter system is entirely
// project-scoped (every mutating function bails without a current project and
// persists to one board's saved view), so My Tasks needs its own selection
// that resets on reload. The matching itself must stay the shared
// priorityFilterCondition so "No Priority" behaves exactly like on a board.
import assert from "node:assert/strict";
import test from "node:test";

import { filterMyTasksByPriority } from "../src/lib/myTasksFiltering";
import { PriorityConstants } from "../src/lib/constants/constants";
import type { ISection } from "../src/models/model";

const task = (id: number, priorityIndex?: number) => ({
  id,
  ...(priorityIndex === undefined
    ? {}
    : { priority: { priority_index: priorityIndex } }),
});

const sections = [
  { id: 100, section_title: "Board A", items: [task(1, 1), task(2, 3)] },
  { id: 200, section_title: "Board B", items: [task(3, 2), task(4)] },
] as unknown as ISection[];

test("an empty selection returns the sections untouched", () => {
  assert.deepEqual(filterMyTasksByPriority(sections, []), sections);
});

test("selecting Urgent + High keeps only those tasks across boards", () => {
  const selected = PriorityConstants.filter((p) =>
    [1, 2].includes(p.priority_index)
  );
  const filtered = filterMyTasksByPriority(sections, selected);

  assert.deepEqual(
    filtered.map((section) => section.items.map((item) => item.id)),
    [[1], [3]]
  );
  // Tabs stay even when a board has nothing left, so navigation is stable.
  assert.deepEqual(
    filtered.map((section) => section.id),
    [100, 200]
  );
});

test("selecting No Priority keeps unprioritized tasks, like a board filter", () => {
  const noPriority = PriorityConstants.filter(
    (p) => p.priority_index === 0
  );
  const filtered = filterMyTasksByPriority(sections, noPriority);

  assert.deepEqual(
    filtered.map((section) => section.items.map((item) => item.id)),
    [[], [4]]
  );
});

test("a selection matching nothing empties every board but keeps the tabs", () => {
  const low = PriorityConstants.filter((p) => p.priority_index === 4);
  const filtered = filterMyTasksByPriority(sections, low);

  assert.deepEqual(
    filtered.map((section) => section.items.length),
    [0, 0]
  );
});

test("filtering does not mutate the input sections", () => {
  const before = JSON.parse(JSON.stringify(sections));
  filterMyTasksByPriority(
    sections,
    PriorityConstants.filter((p) => p.priority_index === 1)
  );
  assert.deepEqual(sections, before);
});
