const { human, other, agent, agentB, date, BASE } = require("./fixture.cjs");
const cases = [];
const add = (name, type, searchPayload, expected, match, options = {}) =>
  cases.push({ name: `filter ${name}`, filters: [{ type, searchPayload, ...(match ? { match } : {}) }], expected, ...options });

add("Labels ANY red", "Labels", [{ id: "red" }], ["a", "c", "h", "e"]);
add("Labels ANY red or blue", "Labels", [{ id: "red" }, { id: "blue" }], ["a", "b", "c", "h", "e", "f"], "ANY");
add("Labels ALL red and blue", "Labels", [{ id: "red" }, { id: "blue" }], ["c"], "ALL");
add("Labels ANY foreign", "Labels", [{ id: "foreign" }], []);
add("Labels ANY empty", "Labels", [], BASE, "ANY");
add("Labels ALL empty", "Labels", [], BASE, "ALL");
add("Assignees ANY human excludes agent-only rows", "Assignees", [human], ["a", "c", "h"], "ANY");
add("Assignees default human excludes agent-only rows", "Assignees", [human], ["a", "c", "h"]);
add("Assignees ANY other human excludes owned agents", "Assignees", [other], ["d"], "ANY");
add("Assignees ANY agent", "Assignees", [agent], ["b", "c", "h"], "ANY");
add("Assignees ANY second agent", "Assignees", [agentB], ["e"], "ANY");
add("Assignees ANY human or agent", "Assignees", [human, agent], ["a", "b", "c", "h"], "ANY");
add("Assignees ALL human and agent independent of row order", "Assignees", [human, agent], ["c", "h"], "ALL");
add("Assignees ALL human", "Assignees", [human], ["a", "c", "h"], "ALL");
add("Assignees ALL two humans", "Assignees", [human, other], [], "ALL");
add("Assignees ANY empty means no restriction", "Assignees", [], BASE, "ANY");
add("Assignees ALL empty means no restriction", "Assignees", [], BASE, "ALL");
add("Assignees ANY missing uid is not a human", "Assignees", [{ id: 6 }], []);
add("Assignees ANY wrong ID type", "Assignees", [{ ...human, id: "6" }], []);
add("Assignees Assigned to me persists author identity", "Assignees", [human], ["a", "c", "h"]);
add("BlockedByPerson Valentin", "BlockedByPerson", [human], ["a"]);
add("BlockedByPerson Ada", "BlockedByPerson", [other], ["b"]);
add("BlockedByPerson Anyone", "BlockedByPerson", [{ id: 0 }], ["a", "b"]);
add("BlockedByPerson empty", "BlockedByPerson", [], []);
for (const [label, index, expected] of [
  ["No Priority", 0, ["g", "e", "f"]], ["Urgent", 1, ["a"]], ["High", 2, ["b", "h"]],
  ["Medium", 3, ["c"]], ["Low", 4, ["d"]],
]) add(`Priority ${label}`, "Priority", [{ priority_index: index }], expected);
add("Priority multiple", "Priority", [{ priority_index: 1 }, { priority_index: 4 }], ["a", "d"]);
add("Priority empty", "Priority", [], []);
for (const [label, index, expected] of [
  ["No size", 0, ["g", "f"]], ["XS", 2, ["a"]], ["S", 3, ["b", "h"]],
  ["M", 4, ["c"]], ["L", 5, ["d"]], ["XL", 6, ["e"]],
]) add(`Size ${label}`, "Size", [{ estimate_index: index }], expected);
add("Size multiple", "Size", [{ estimate_index: 2 }, { estimate_index: 6 }], ["a", "e"]);
add("Size empty", "Size", [], []);
for (const [value, expected] of [["Normal", ["a", "b", "g", "c", "h", "d"]], ["Archive", ["e"]], ["Deleted", ["f"]]])
  add(`Status ${value}`, "Status", [{ value }], expected);
add("Status empty", "Status", [], BASE);
add("Inbox present includes read", "Inbox", [], ["a", "b"]);
add("Unread unseen only", "Unread", [], ["a"]);
add("Starred own projected star", "Starred", [human], ["a", "c"]);
add("Starred empty", "Starred", [], BASE);
add("UpdatedBy human", "UpdatedBy", [human], ["b", "h", "d", "f"]);
add("UpdatedBy other human", "UpdatedBy", [other], ["a", "g", "c", "e"]);
add("UpdatedBy agent attribution", "UpdatedBy", [agent], ["b"]);
add("UpdatedBy multiple", "UpdatedBy", [human, other], BASE);
add("UpdatedBy empty", "UpdatedBy", [], BASE);
add("CreatedBy human", "CreatedBy", [human], ["a", "g", "c", "e"]);
add("CreatedBy other human", "CreatedBy", [other], ["b", "h", "d", "f"]);
add("CreatedBy numeric string", "CreatedBy", [{ ...human, id: "6" }], ["a", "g", "c", "e"]);
add("CreatedBy multiple", "CreatedBy", [human, other], BASE);
add("CreatedBy empty", "CreatedBy", [], BASE);
add("NoRecentComment stale", "NoRecentComment", [], ["h", "d"]);
add("StuckInColumn stale", "StuckInColumn", [], ["h", "d"]);
add("StaleOnBoard stale", "StaleOnBoard", [], ["h", "d", "e"]);
add("NotStale fresh comment and column despite old creation", "NotStale", [], ["a", "b", "g", "c", "e", "f"]);
add("RunningTimer enabled", "RunningTimer", [], ["a", "e"]);
add("RunningTimer disabled", "RunningTimer", [], [], undefined, { projectSettings: { timeTrackingEnabled: false } });
add("RunningTimer missing runtime", "RunningTimer", [], [], undefined, { noRuntime: true });
add("RunningTimer empty runtime", "RunningTimer", [], [], undefined, { runningIds: [] });
add("RunningTimer unrelated ID", "RunningTimer", [], [], undefined, { runningIds: ["foreign"] });

const dateTypes = ["UpdatedRange", "CreatedAt", "DueDate"];
for (const type of dateTypes) {
  const due = type === "DueDate";
  for (const [range, createdIds, dueIds] of [
    ["TODAY", ["a"], ["a"]], ["YESTERDAY", ["b"], ["b"]],
    ["LAST_7_DAYS", ["a", "b", "c"], ["a", "b"]],
    ["LAST_30_DAYS", ["a", "b", "c", "h", "d"], ["a", "b", "d"]],
    ["THIS_WEEK", ["a", "b", "f"], ["a", "b"]],
    ["THIS_MONTH", ["a", "b", "c", "h", "f"], ["a", "b", "c", "d", "e"]],
    ["OVERDUE", ["b", "c", "h", "d", "e"], ["b", "d"]],
    ["NEXT_7_DAYS", ["a", "f"], ["a", "c"]],
    ["ANY", BASE, ["a", "b", "c", "h", "d", "e"]],
    ["UNKNOWN", [], []],
  ]) add(`${type} ${range}`, type, [{ dynamicRange: range }], due ? dueIds : createdIds);
  add(`${type} BEFORE strict`, type, [{ selectedDate: date("11-18"), condition: "BEFORE" }], due ? ["b", "d"] : ["b", "c", "h", "d", "e"]);
  add(`${type} AFTER strict`, type, [{ selectedDate: date("11-18"), condition: "AFTER" }], due ? ["c", "h", "e"] : ["f"]);
  add(`${type} inferred BEFORE future`, type, [{ selectedDate: date("11-22"), condition: null }], due ? ["a", "b", "d"] : ["a", "b", "c", "h", "d", "e"]);
  add(`${type} inferred AFTER past`, type, [{ selectedDate: date("11-17"), condition: null }], due ? ["a", "c", "h", "e"] : ["a", "f"]);
  add(`${type} inclusive exact timestamp range`, type, [{ fromDate: date("11-17"), toDate: date("11-18") }], ["a", "b"]);
  add(`${type} custom calendar range includes final day`, type, [{ fromDate: "2026-11-17T00:00:00.000Z", toDate: "2026-11-18T00:00:00.000Z" }], ["a", "b"]);
  add(`${type} empty date selection`, type, [{}], due ? ["a", "b", "c", "h", "d", "e"] : BASE);
}
add("DueDate NO_DUE_DATE", "DueDate", [{ dynamicRange: "NO_DUE_DATE" }], ["g", "f"]);
add("DueDate Any date condition", "DueDate", [{ condition: "ANY" }], ["a", "b", "c", "h", "d", "e"]);
const combined = [
  { type: "Labels", searchPayload: [{ id: "red" }, { id: "blue" }], match: "ALL" },
  { type: "Priority", searchPayload: [{ priority_index: 2 }] },
];
cases.push(
  { name: "filter global ALL intersects value ALL", filters: combined, overall: "ALL", expected: [] },
  { name: "filter global ANY unions value ALL", filters: combined, overall: "ANY", expected: ["b", "c", "h"] },
  { name: "filter clear all", filters: [], expected: BASE },
  { name: "filter unknown type rejects rows", filters: [{ type: "Unknown", searchPayload: [] }], expected: [] },
);
module.exports = { cases, dateTypes };
