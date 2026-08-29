const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "src/components/Common/CommonModalComponents/index.tsx",
  ),
  "utf8",
);

test("shared modals use a consistent 24px content inset", () => {
  assert.match(source, /\[--bs-modal-padding:1\.5rem\]/);
  assert.match(source, /font-medium px-6 py-0/);
  assert.match(source, /border-none gap-2 mt-2 px-6/);
  assert.doesNotMatch(source, /px-\[6px\]/);
});

test("header separators stay inside every modal width", () => {
  assert.match(source, /h-\[1px\] w-full/);
  assert.doesNotMatch(source, /sm:w-\[630px\]/);
});
