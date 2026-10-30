const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

test("only server-internal callers opt out of the membership check", () => {
  const allowed = new Set([
    "src/utils/controllers/tasks/single.ts",
    "src/utils/controllers/tasks/sweepAutoArchive.ts",
    "src/app/api/webhooks/github/route.ts",
    "src/app/api/cron/slack-thread-summaries/route.ts",
    "src/lib/aiFeedback/report.ts",
    "src/lib/ai/batch/collectBatches.ts",
    "src/utils/controllers/comments/createCommentService.ts",
    "src/utils/controllers/comments/persistComment.ts",
    "src/utils/controllers/comments/commentCreationTypes.ts",
  ]);
  const root = path.join(__dirname, "..", "src");
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) {
        if (fs.readFileSync(full, "utf8").includes("trustedCaller")) {
          found.push(path.relative(path.join(__dirname, ".."), full));
        }
      }
    }
  };
  walk(root);
  const unexpected = found.filter((f) => !allowed.has(f));
  assert.deepEqual(
    unexpected,
    [],
    `new trustedCaller opt-outs need review: ${unexpected.join(", ")}`,
  );
});
