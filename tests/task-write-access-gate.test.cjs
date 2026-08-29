const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// The opt-out exists for callers whose trust is established elsewhere (a cron,
// a signature-checked webhook). Anything reached by a browser request must not
// use it, so the list stays short and reviewed.
test("only server-internal callers opt out of the membership check", () => {
  const allowed = new Set([
    "src/utils/controllers/tasks/single.ts", // where the option is defined
    "src/utils/controllers/tasks/sweepAutoArchive.ts", // cron
    "src/app/api/webhooks/github/route.ts", // signature-checked webhook
    "src/app/api/cron/slack-thread-summaries/route.ts", // authenticated cron
    "src/utils/controllers/comments/createCommentService.ts", // where the option is propagated
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
