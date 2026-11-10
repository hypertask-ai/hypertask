const assert = require("node:assert/strict");
const { applyFilters, labelFilterCondition } = require("./filter-match-mode-entry.cjs");

const selected = [{ id: "bug" }, { id: "error log" }];
const taskWithLabels = (...ids) => ({
  taskLabels: ids.map((id) => ({ label: { id } })),
});
const sections = [{
  items: [
    { id: "bug", ...taskWithLabels("bug") },
    { id: "error", ...taskWithLabels("error log") },
    { id: "both", ...taskWithLabels("bug", "feature") },
    { id: "feature", ...taskWithLabels("feature") },
    { id: "plain", ...taskWithLabels() },
  ],
}];
const hide = [{ type: "Labels", searchPayload: selected, match: "HIDE" }];

assert.deepEqual(
  applyFilters(sections, hide, "ANY", undefined, { tagHideFilterEnabled: true })[0].items.map(({ id }) => id),
  ["feature", "plain"],
);
assert.equal(labelFilterCondition(taskWithLabels("bug"), selected, undefined, "ANY"), true);
assert.equal(labelFilterCondition(taskWithLabels("bug", "annoying"), selected.slice(0, 1).concat([{ id: "annoying" }]), undefined, "ALL"), true);

const mixed = [{
  items: [
    { id: "bug-mine", taskLabels: [{ label: { id: "bug" } }], assignees: [{ userId: 7, agentId: null }] },
    { id: "bug-other", taskLabels: [{ label: { id: "bug" } }], assignees: [{ userId: 8, agentId: null }] },
    { id: "mine", taskLabels: [{ label: { id: "feature" } }], assignees: [{ userId: 7, agentId: null }] },
  ],
}];
assert.deepEqual(
  applyFilters(mixed, [
    { type: "Labels", searchPayload: [{ id: "bug" }], match: "HIDE" },
    { type: "Assignees", searchPayload: [{ id: 7, uid: "user-7" }] },
  ], "ANY")[0].items.map(({ id }) => id),
  ["bug-mine", "mine"],
);

console.log("HIDE-TAG-OK");
