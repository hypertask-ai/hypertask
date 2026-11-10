import assert from "node:assert/strict";
import test from "node:test";
import {
  addFieldOptions,
  customFieldIdFromOptionKey,
  customFieldOptionKey,
  filledRightColumnFields,
  type RightColumnFieldValues,
} from "../src/lib/taskDetail/rightColumnFields";

const emptyTicket: RightColumnFieldValues = {
  assigneeCount: 0,
  agentCount: 0,
  dueDate: null,
  cyclesEnabled: false,
  cycle: null,
  priority: null,
  size: undefined,
  tagValues: [],
};

const fullTicket: RightColumnFieldValues = {
  assigneeCount: 2,
  agentCount: 1,
  dueDate: "2026-11-14T00:00:00.000Z",
  cyclesEnabled: true,
  cycle: { id: 1, number: 4 },
  priority: { priority_index: 1 },
  size: "Medium",
  tagValues: ["Growth", "Pricing"],
};

const customFields = [
  { id: "cf-ice", name: "ICE" },
  { id: "cf-team", name: "Owner team" },
];

test("an empty ticket hides every optional row and offers each one in Add field", () => {
  const filled = filledRightColumnFields(emptyTicket);
  assert.deepEqual(Object.values(filled), Object.values(filled).map(() => false));
  assert.deepEqual(
    addFieldOptions(emptyTicket, customFields, []).map((option) => option.label),
    ["Assignee", "Agent", "Due date", "Priority", "Size", "Tags", "ICE", "Owner team"],
  );
});

test("Status and Project are never optional rows", () => {
  const labels = addFieldOptions(emptyTicket, [], []).map((option) => option.label);
  assert.equal(labels.includes("Status"), false);
  assert.equal(labels.includes("Project"), false);
});

test("a full ticket shows every filled row and offers nothing to add", () => {
  const filled = filledRightColumnFields(fullTicket);
  assert.deepEqual(Object.values(filled), Object.values(filled).map(() => true));
  assert.deepEqual(
    addFieldOptions(fullTicket, customFields, [
      { fieldId: "cf-ice", value: "8" },
      { fieldId: "cf-team", value: "Growth" },
    ]),
    [],
  );
});

test("Add field lists only the empty fields of a half-filled ticket", () => {
  const values = { ...emptyTicket, assigneeCount: 1, priority: { priority_index: 2 } };
  assert.deepEqual(
    addFieldOptions(values, customFields, [{ fieldId: "cf-ice", value: "8" }]).map(
      (option) => option.label,
    ),
    ["Agent", "Due date", "Size", "Tags", "Owner team"],
  );
});

test("placeholder values count as empty", () => {
  const filled = filledRightColumnFields({
    ...emptyTicket,
    size: "-",
    tagValues: [null, undefined, ""],
  });
  assert.equal(filled.size, false);
  assert.equal(filled.tags, false);
  assert.deepEqual(
    addFieldOptions(emptyTicket, customFields, [{ fieldId: "cf-ice", value: "" }])
      .filter((option) => option.label === "ICE").length,
    1,
  );
});

test("Cycle is offered only on boards with cycles", () => {
  assert.equal(
    addFieldOptions(emptyTicket, [], []).some((option) => option.key === "cycle"),
    false,
  );
  assert.equal(
    addFieldOptions({ ...emptyTicket, cyclesEnabled: true }, [], []).some(
      (option) => option.key === "cycle",
    ),
    true,
  );
});

test("custom field option keys round-trip to their string field id", () => {
  const id = "5c1d2a4e-8f0b-4c47-9a51-0f7e3d2b1a90";
  assert.equal(customFieldIdFromOptionKey(customFieldOptionKey(id)), id);
  assert.equal(customFieldIdFromOptionKey("dueDate"), null);
});

test("a value saved in the column updates Add field without a reload", () => {
  const labels = (edits: Record<string, string>) =>
    addFieldOptions(emptyTicket, customFields, [{ fieldId: "cf-team", value: "Growth" }], edits)
      .map((option) => option.label)
      .filter((label) => label === "ICE" || label === "Owner team");
  assert.deepEqual(labels({}), ["ICE"]);
  assert.deepEqual(labels({ "cf-ice": "8" }), []);
  assert.deepEqual(labels({ "cf-team": "" }), ["ICE", "Owner team"]);
});
