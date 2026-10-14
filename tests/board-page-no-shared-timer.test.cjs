// HTPR-7219: console.time labels are process-wide. The board page used one
// fixed "board" label, so concurrent requests ended each other's timer and
// Vercel logged "No such label 'board' for console.timeEnd()".
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PAGE = path.resolve(__dirname, "../src/app/[...boardURL]/page.tsx");
const source = fs.readFileSync(PAGE, "utf8");

test("board page uses no shared console.time label", () => {
  assert.doesNotMatch(source, /console\.time(End|Log)?\s*\(/);
});
