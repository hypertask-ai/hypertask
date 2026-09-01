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
  const emptyAssigneeValue = source.match(
    /\{formValues\.assignees\.length < 1 && \(\s*(<span[\s\S]*?<\/span>)\s*\)\}/,
  );
  assert.ok(emptyAssigneeValue, "empty assignee value should render a span");
  assert.match(emptyAssigneeValue[1], /className="relative whitespace-nowrap"/);
  assert.match(emptyAssigneeValue[1], />\s*The Assignees/);
  assert.doesNotMatch(source, /style=\{\{ height: 40 \}\}/);
  assert.doesNotMatch(source, /flex flex-col ml-\[20px\]/);
});
