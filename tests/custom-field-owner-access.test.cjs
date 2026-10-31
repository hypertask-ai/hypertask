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
