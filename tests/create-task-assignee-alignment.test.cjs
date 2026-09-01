const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const source = fs.readFileSync(
  "src/components/Modals/CreateTaskGloballyModal/AssigneesTaskGlobal/AssigneesContainerCreateTaskGlobally.tsx",
  "utf8",
);

test("the create-task assignee row uses the shared aligned field primitives", () => {
  assert.match(source, /<TaskInfoLabel[\s\S]*Assignees[\s\S]*<\/TaskInfoLabel>/);
  assert.match(source, /<TaskInfoValue[\s\S]*The Assignees[\s\S]*<\/TaskInfoValue>/);
  assert.match(
    source,
    /formValues\.assignees\.length < 1[\s\S]*className="relative whitespace-nowrap"[\s\S]*The Assignees/,
  );
  assert.doesNotMatch(source, /style=\{\{ height: 40 \}\}/);
  assert.doesNotMatch(source, /flex flex-col ml-\[20px\]/);
});
