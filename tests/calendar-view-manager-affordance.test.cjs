const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "..", "src/components/Modals/Calendar/views.modal.tsx"),
  "utf8",
);

test("calendar view manager exposes edit and close affordances", () => {
  assert.match(source, /aria-label="Close calendar views"/);
  assert.match(source, /aria-label=\{`Edit \$\{everythingTitle\}`\}/);
  assert.match(source, /\? `Edit \$\{view\.title\}`/);
  assert.match(source, /<Settings[\s\S]*?aria-hidden/);
});

test("calendar view manager keeps teammate-owned views read-only", () => {
  assert.match(source, /view\.userId !== currentUser\?\.id/);
  assert.match(source, /aria-disabled=\{view\.userId !== currentUser\?\.id\}/);
  assert.match(source, /Only the owner can rename or delete this view/);
});
