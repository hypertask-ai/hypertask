// HTPR-5871: the attachment gallery (yet-another-react-lightbox) pinned its
// toolbar to top: 0, so on the Android shell (edge-to-edge WebView that
// reports env(safe-area-inset-top) as 0) the fullscreen / download / zoom /
// close icons rendered under the status-bar clock and battery. The toolbar
// must clear the status bar with the same 28px floor the palette modals use,
// and the plugin buttons must sit at even spacing.
//
// jsdom does not evaluate @media queries or env(), so this follows the house
// pattern of asserting the compiled-into-globals.scss rule set (see
// tests/mobile-undo-toast.test.cjs).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const globals = fs.readFileSync(
  path.join(root, "src/styles/globals.scss"),
  "utf8"
);

const mobileBlockStart = globals.indexOf("@media (max-width: 767px)");
const nextMedia = globals.indexOf("\n@media ", mobileBlockStart);
const mobileBlock = globals.slice(
  mobileBlockStart,
  nextMedia === -1 ? undefined : nextMedia
);

test("the gallery toolbar clears the status bar on mobile", () => {
  const start = mobileBlock.indexOf(".yarl__portal .yarl__toolbar");
  assert.ok(start !== -1, "mobile block styles the lightbox toolbar");
  const rule = mobileBlock
    .slice(start, mobileBlock.indexOf("}", start) + 1);

  assert.match(
    rule,
    /top:\s*max\(env\(safe-area-inset-top\),\s*28px\)/,
    "toolbar top uses the 28px status-bar floor, not top: 0",
  );
  assert.match(rule, /gap:\s*\d+px/, "toolbar buttons sit at even spacing");
});

test("the safe-area offset survives the lightbox RTL cascade", () => {
  // YARL ships [dir=rtl] .yarl__toolbar { top: 0 }, which ties our unscoped
  // rule on specificity; the explicit RTL override keeps the floor.
  assert.match(
    mobileBlock,
    /\[dir="rtl"\] \.yarl__portal \.yarl__toolbar\s*\{[^}]*top:\s*max\(env\(safe-area-inset-top\),\s*28px\)/,
  );
});
