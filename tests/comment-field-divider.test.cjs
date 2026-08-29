const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(
    process.cwd(),
    "src/components/Common/AttachmentsUpload/index.tsx",
  ),
  "utf8",
);

test("comment composer does not separate its text and actions with a divider", () => {
  assert.match(source, /!_mbl && mode !== "create-comment"/);
  assert.match(source, /<hr className=/);
});
