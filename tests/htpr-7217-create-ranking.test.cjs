const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const route = fs.readFileSync(
  path.join(__dirname, "..", "src/lib/api/task-writes/create-global.ts"),
  "utf8",
);

test("HTPR-7217: global create never hands a non-string ranking to Prisma", () => {
  assert.match(route, /ranking == null \|\| typeof ranking === "string"\s*\?\s*ranking\s*:\s*generateRank\(/);
  assert.match(route, /sectionId: sectionRow\.id, projectId, status: "Normal"[\s\S]*orderBy: \{ ranking: "desc" \}/);
  assert.match(route, /ticketNumber: [^\n]*\n\s*ranking: taskRanking,/);
});
