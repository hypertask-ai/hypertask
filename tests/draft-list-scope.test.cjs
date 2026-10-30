const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const routeSource = fs.readFileSync(
  path.join(__dirname, "..", "src/lib/mcp/operations/drafts/operation.ts"),
  "utf8"
);

test("listing drafts is scoped to the calling user", () => {
  const listQuery = routeSource.slice(routeSource.indexOf("prisma.drafts.findMany"));
  const where = listQuery.slice(listQuery.indexOf("where:"), listQuery.indexOf("include:"));
  assert.match(where, /taskId: task\.id/);
  assert.match(where, /userId: user\.id/);
});

test("update, delete and publish still refuse another user's draft", () => {
  const draftIdRoute = fs.readFileSync(
    path.join(__dirname, "..", "src/lib/mcp/operations/drafts/[draft_id]/operation.ts"),
    "utf8"
  );
  const publishRoute = fs.readFileSync(
    path.join(__dirname, "..", "src/lib/mcp/operations/drafts/[draft_id]/publish/operation.ts"),
    "utf8"
  );
  assert.strictEqual(
    (draftIdRoute.match(/draft\.userId !== user\.id/g) || []).length,
    2,
    "PATCH and DELETE must each check draft ownership"
  );
  assert.match(publishRoute, /draft\.userId !== user\.id/);
});
