const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("page route allows native pinch zoom on phones", () => {
  const route = read("src/app/page/[publicId]/page.tsx");
  assert.match(route, /export const viewport = \{[^}]*userScalable: true/s);
  assert.match(route, /maximumScale: 5/);
});

test("page content does not block the pinch gesture", () => {
  const editor = read("src/app/page/[publicId]/PageEditor.tsx");
  assert.doesNotMatch(editor, /touch-pan-y/);
  assert.match(editor, /touch-manipulation/);
  const hook = read("src/hooks/General/useContentZoom.ts");
  // Pinching in from 100% is left to the browser; ours only goes up to 100%.
  assert.match(hook, /mode = "native"|: "native"/);
  assert.match(hook, /Math\.min\(1, pinch\.startZoom \* ratio\)/);
});
