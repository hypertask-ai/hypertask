// HTPR-7231: console.time labels are process-wide. The ticket page labelled its
// timer with the ticket slug, so two requests for the same ticket ended each
// other's timer and Vercel logged "No such label ... for console.timeEnd()".
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PAGE = path.resolve(__dirname, "../src/app/detail/[...slug]/page.tsx");
const source = fs.readFileSync(PAGE, "utf8");

test("ticket detail page uses no shared console.time label", () => {
  assert.doesNotMatch(source, /console\.time(End|Log)?\s*\(/);
});
