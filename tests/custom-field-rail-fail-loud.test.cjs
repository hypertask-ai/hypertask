// HTPR-3805: a failed custom-field save (e.g. the owner-403 bug) discarded
// the error silently and reverted the typed value with no explanation, which
// looked like "the number just didn't save". The rail editor must surface
// the failure via toast, matching how sibling rail properties report saves
// that fail (see the "Unable to clear blocked by person" toast in this file).
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
