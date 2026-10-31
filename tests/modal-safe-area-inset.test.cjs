"use strict";


const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const CONTAINER = path.join(
  __dirname,
  "..",
  "src/components/Common/CommonModalComponents/index.tsx",
);
const source = fs.readFileSync(CONTAINER, "utf8");

test("mobile modals clear the status bar instead of pinning to the viewport top", () => {
  assert.match(
    source,
    /xs:top-\[env\(safe-area-inset-top\)\]/,
    "ModalContainerCustom must offset mobile modals by the top safe-area inset",
  );
});

test("no mobile breakpoint pins a modal to a bare top-0", () => {
  assert.doesNotMatch(
    source,
    /xs:top-0\b/,
    "xs:top-0 puts the modal's first row under the Android status bar",
  );
});

test("the desktop position is untouched", () => {
  assert.match(source, /sm:top-\[180px\]/);
});
