const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

// HTPR-7112: the toast after deleting a comment is spelled correctly.
test("comment deleted toasts say successfully", () => {
  for (const file of [
    "src/components/Modals/commands/DeleteCommentById.tsx",
    "src/components/Modals/commands/DeleteMessage.tsx",
  ]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(source, /Comment deleted successfully/, file);
    assert.doesNotMatch(source, /succesfully/, file);
  }
});
