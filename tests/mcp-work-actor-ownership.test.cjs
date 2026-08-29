const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("lease heartbeat and release isolate sibling agents", () => {
  for (const route of ["heartbeat", "release"]) {
    const source = read(`src/app/api/mcp/tasks/lease/${route}/route.ts`);
    assert.match(
      source,
      /AND "holder" = \$\{ctx\.user\.id}\s+AND \(\$\{ctx\.agentId}::text IS NULL OR "agentId" = \$\{ctx\.agentId}\)/,
    );
  }
});

test("session heartbeats do not treat sibling agents as the same owner", () => {
  const source = read("src/app/api/mcp/tasks/session/route.ts");
  const exactActorCheck = /ctx\.agentId !== null\s+\? \w+\.agentId === ctx\.agentId\s+: \w+\.startedById === ctx\.user\.id/g;

  assert.equal(
    [...source.matchAll(exactActorCheck)].length,
    2,
    "both the normal heartbeat and create-race retry must check the exact actor",
  );
});

test("only the creating agent or an authorized human may cancel a decision", () => {
  const source = read("src/app/api/mcp/decisions/[id]/route.ts");
  assert.match(
    source,
    /const canCancel = ctx\.agentId !== null\s+\? ctx\.agentId === decisionRequest\.agentId\s+: ctx\.user\.id === decisionRequest\.createdById \|\|\s+ctx\.user\.id === taskOwner\.userId/,
  );
});
