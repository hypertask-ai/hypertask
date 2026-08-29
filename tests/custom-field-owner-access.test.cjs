// HTPR-3805: a board OWNER has no Member row, so gating custom-field routes on
// a bare Member lookup 403'd every owner-only board (session cookie routes
// only — the MCP twin routes already used the owner-OR-member predicate via
// getProjectWhere/validateProjectAccess and worked fine). These routes must
// use the same getProjectWhere predicate, not prisma.member.findFirst.
//
// No DB test harness exists in this repo (see board-unauthorized-inline.test.cjs
// for the same source-inspection convention), so this guards the regression at
// the source level rather than exercising the route against a live database.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROUTES = [
  path.resolve(__dirname, "../src/app/api/customFields/value/route.ts"),
  path.resolve(__dirname, "../src/app/api/customFields/route.ts"),
];

test("custom field routes gate access with getProjectWhere, not a bare Member lookup", () => {
  for (const file of ROUTES) {
    const source = fs.readFileSync(file, "utf8");
    assert.match(
      source,
      /import \{ getProjectWhere \} from "@\/utils\/controllers\/projects\/getAllIncludes"/,
      `${file} must import getProjectWhere`,
    );
    assert.doesNotMatch(
      source,
      /prisma\.member\.findFirst/,
      `${file} must not gate access with a bare Member lookup`,
    );
  }
});
