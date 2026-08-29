const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const modalFiles = [
  "AssigneeModal.tsx",
  "PriorityModal.tsx",
  "DueDateModal.tsx",
  "MoveModal.tsx",
];

test("guided onboarding modals provide callable toggle props", () => {
  for (const file of modalFiles) {
    const source = fs.readFileSync(
      path.join(
        __dirname,
        "../src/components/PageComponents/Interactive-Onboarding/Components/Modals",
        file
      ),
      "utf8"
    );

    assert.doesNotMatch(source, /toggle=\{activeScene\.index/);
    assert.match(source, /toggle=\{\(\) => undefined\}/);
  }
});
