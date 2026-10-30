const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const FILE = path.resolve(
  __dirname,
  "../src/components/PageComponents/TaskDetail/TaskInfoColumn/TaskInfo.tsx",
);

test("custom field rail editor surfaces save failures via toast", () => {
  const source = fs.readFileSync(FILE, "utf8");
  const saveStart = source.indexOf("async function save(val: string)");
  assert.notEqual(saveStart, -1, "CustomFieldRow's save() moved or was renamed");

  const catchBlock = source.slice(saveStart, source.indexOf("}", source.indexOf("catch (err)", saveStart)));
  assert.match(
    catchBlock,
    /toast\.error\(/,
    "save() must surface the failure via toast, not just console.error + silent rollback",
  );
});
