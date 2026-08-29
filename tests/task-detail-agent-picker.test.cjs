const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const picker = read("src/components/Modals/AssignToUser/AssignToUser.tsx");
const taskDetail = read(
  "src/components/PageComponents/TaskDetail/AssigneesContainer.tsx",
);

test("the task-detail Agents property opens an agents-only picker", () => {
  assert.match(
    taskDetail,
    /openPicker\(label === "Agents" \? "agents" : "assignees"\)/,
  );
  assert.match(taskDetail, /includePeople=\{pickerMode !== "agents"\}/);
  assert.match(
    taskDetail,
    /title=\{pickerMode === "agents" \? "Assign agents" : "Assign"\}/,
  );
});

test("the shared picker excludes every source of people when requested", () => {
  assert.match(picker, /includePeople = true/);
  assert.match(picker, /if \(includePeople\) \{[\s\S]*extraUsers\.forEach/);
  assert.match(
    picker,
    /if \(isAgentOption\(assignee\)\)[\s\S]*\} else if \(includePeople\)/,
  );
  assert.match(picker, /if \(includePeople\) \{[\s\S]*members\.forEach/);
  assert.match(picker, /includePeople && owner/);
  assert.match(picker, /includePeople \? "Type user name" : "Type agent name"/);
});

test("filtered pickers preserve hidden assignments in optimistic updates", () => {
  assert.match(picker, /preserveHiddenAssignedOptions\(/);
  assert.match(picker, /onClose\(completeAssigneeRows\(optimistic\), true\)/);
  assert.match(picker, /onClose\(completeAssigneeRows\(rolledBack\), true\)/);
});

test("the combined Assignees picker keeps People before Agents", () => {
  const optionsStart = picker.indexOf("const allOptions = [");
  const options = picker.slice(
    optionsStart,
    picker.indexOf("];", optionsStart),
  );
  const people = options.indexOf("Array.from(uniqueUsersMap.values())");
  const agents = options.indexOf("Array.from(uniqueAgentsMap.values())");
  assert.ok(people > 0 && agents > people);
  assert.ok(
    picker.indexOf('renderSection("People"') <
      picker.indexOf('renderSection("Agents"'),
  );
});
