const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const { applyFilters } = load("src/utils/helperFunctions/Views/FilterHelperFunctions.ts", {
  "@/utils/helperFunctions/helperFunctions": { deepCopy: structuredClone },
  "@/models/Views/model": { DEFAULT_SUBTASK_SETTING: "Flattened_Card" },
  "@/lib/constants/constants": {},
  "@/lib/staleness": {},
  "@/lib/constants/builtinViews": { getBuiltinView: () => undefined },
  "@/utils/sortByParam": {},
  "./TableColumnsHelperFunctions": {},
  "./SubtaskHelperFunction": {},
  "./EmptySectionsHelperFunction": {},
  "@/lib/sectionAutoAssign": {},
});
const { sanitizeBoardFilters } = load("src/utils/helperFunctions/Views/BoardFilterSanitizer.ts", {});
const owner = { id: 7, uid: "owner-7", displayName: "Owner" };
const agent = { id: "agent-1", displayName: "Agent One" };
const sections = [{ items: [
  { id: 1, userId: 7, agentId: null, priority: { priority_index: 1 } },
  { id: 2, userId: 7, agentId: "agent-1", priority: { priority_index: 2 } },
  { id: 3, userId: 7, agentId: "agent-2", priority: { priority_index: 1 } },
  { id: 4, userId: 8, agentId: null, priority: { priority_index: 2 } },
] }];
const visible = (payload, enabled = true, matchFilters = "ALL", extra = []) => {
  const saved = JSON.parse(JSON.stringify(sanitizeBoardFilters({ matchFilters, addedFilters: [
    { type: "CreatedBy", searchPayload: payload }, ...extra,
  ] })));
  return applyFilters(sections, saved.addedFilters, saved.matchFilters, undefined, {
    agentCreatorFilterEnabled: enabled,
  })[0].items.map(({ id }) => id);
};

test("saved agent creator filter selects only that agent, not its owner or siblings", () => {
  assert.deepEqual(visible([agent]), [2]);
});

test("saved human creator filter excludes agents owned by that person", () => {
  assert.deepEqual(visible([owner]), [1]);
});

test("legacy numeric-string user IDs remain valid", () => {
  assert.deepEqual(visible([{ id: "7", uid: "owner-7" }]), [1]);
});

test("empty creator filters do not hide tickets", () => {
  assert.deepEqual(visible([]), [1, 2, 3, 4]);
});

test("creator filters compose with other filters under ANY and ALL after reload", () => {
  const priority = { type: "Priority", searchPayload: [{ priority_index: 1 }] };
  assert.deepEqual(visible([agent], true, "ANY", [priority]), [1, 2, 3]);
  assert.deepEqual(visible([agent], true, "ALL", [priority]), []);
  assert.deepEqual(visible([owner], true, "ALL", [priority]), [1]);
});

test("flag off restores the existing human creator behavior", () => {
  assert.deepEqual(visible([owner], false), [1, 2, 3]);
  assert.deepEqual(visible([agent], false), []);
});

for (const enabled of [false, true]) {
  test(`creator picker preserves people and ${enabled ? "includes" : "hides"} agents with flag ${enabled}`, async () => {
    const selected = [];
    const { useCreatedByFilter } = load("src/hooks/MultiPages/Filters/useCreatedByFilter.ts", {
      react: { useMemo: (fn) => fn() },
      "@/hooks/useFlag": { useFlag: () => enabled },
      "@/hooks/MultiPages/useAgents": { useAgents: () => ({ allAgents: [agent, { id: "revoked", revokedAt: "2026-10-01" }] }) },
      "@/store": { currentProjectAtom: "project", calendarTaskFiltersAtom: "calendar" },
      "@/lib/state": { useRecoilValue: (atom) => atom === "project" ? { id: 15 } : { createdBy: [] } },
      "@/hooks/MultiPages/useGetMembersForAssignees": { useGetAllMembersForAssign: () => ({ data: { owner, members: [] } }) },
      "@/utils/helperFunctions/Views/ViewsHelperFunctions": { getActiveFiltersFromProject: () => ({ addedFilters: [] }) },
      "@/lib/myTasksFilterContext": { useMyTasksFilterController: () => null },
    });
    const picker = useCreatedByFilter({ view: "Kanban", createdByHandler: async (entry) => selected.push(entry) });
    assert.deepEqual(picker.allUsers.map(({ id }) => id), enabled ? [7, "agent-1"] : [7]);
    picker.onSelectHandler(enabled ? agent : owner);
    picker.onSelectHandler(undefined);
    assert.deepEqual(selected, [enabled ? agent : owner, undefined]);
  });
}

test("creator filter flag is reversible and defaults to Everyone", () => {
  const { default: definition } = load("src/lib/flags/definitions/htpr-7865-agent-creator-filter.ts", {});
  assert.equal(definition.key, "htpr-7865-agent-creator-filter");
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
});
