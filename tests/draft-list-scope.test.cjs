const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const routeSource = fs.readFileSync(
  path.join(__dirname, "..", "src/app/api/mcp/drafts/route.ts"),
  "utf8"
);

// A draft is unpublished private text. Listing them by task alone handed every
// board member someone else's half-written comment (HTPR-4946).
test("listing drafts is scoped to the calling user", () => {
  const listQuery = routeSource.slice(routeSource.indexOf("prisma.drafts.findMany"));
  const where = listQuery.slice(listQuery.indexOf("where:"), listQuery.indexOf("include:"));
  assert.match(where, /taskId: task\.id/);
  assert.match(where, /userId: user\.id/);
});

// The other three routes refuse to act on a draft the caller does not own.
// If any of those checks disappears, the list scope above is not enough.
test("update, delete and publish still refuse another user's draft", () => {
  const draftIdRoute = fs.readFileSync(
    path.join(__dirname, "..", "src/app/api/mcp/drafts/[draft_id]/route.ts"),
    "utf8"
  );
  const publishRoute = fs.readFileSync(
    path.join(__dirname, "..", "src/app/api/mcp/drafts/[draft_id]/publish/route.ts"),
    "utf8"
  );
  assert.strictEqual(
    (draftIdRoute.match(/draft\.userId !== user\.id/g) || []).length,
    2,
    "PATCH and DELETE must each check draft ownership"
  );
  assert.match(publishRoute, /draft\.userId !== user\.id/);
});
