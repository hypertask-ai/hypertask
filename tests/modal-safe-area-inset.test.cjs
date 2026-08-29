"use strict";

// The app runs viewportFit:"cover", so the Android status bar draws over page
// content. A mobile modal pinned to a bare top-0 puts its first row underneath
// that bar: the header is invisible and taps near the top reach system UI
// instead of the dialog. The discard confirmation is where this was reported —
// it looked broken because the Discard row was partly unreachable (HTPR-5534).
//
// 72 files render through ModalContainerCustom, so this guard protects every
// mobile modal, not just the one that was reported.

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
  // env() resolves to 0 without an inset, so this fix must not move anything
  // on desktop, where the modal deliberately sits 180px down.
  assert.match(source, /sm:top-\[180px\]/);
});
