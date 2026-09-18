const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "src/app/api/mcp/tasks/move/route.ts"),
  "utf8"
);

test("tasks/move adopts a mutation lease and releases it after the write (HTPR-6391)", () => {
  assert.match(
    source,
    /import \{ withAdoptedAgentMutationLease \} from "@\/lib\/mcp\/tasks\/agentMutationLeaseAdoption";/
  );
  assert.doesNotMatch(source, /withAgentMutationLeaseAdoption/);

  // The move write must be the direct callback of withAdoptedAgentMutationLease.
  // That helper adopts for the request and releases the exact token afterward,
  // so a following exclusive claim does not wait for TTL expiry after assign+move.
  const wrappedCallPattern =
    /withAdoptedAgentMutationLease\(\s*prisma,\s*\{ agentId: ctx\.agentId, userId: currentUser\.id \},\s*\(\)\s*=>[\s\S]{0,40}?moveTaskToDifferentBoard\(/g;
  const moveCalls = source.match(/moveTaskToDifferentBoard\(/g) ?? [];
  const wrappedCalls = source.match(wrappedCallPattern) ?? [];

  assert.equal(
    wrappedCalls.length,
    moveCalls.length,
    "each moveTaskToDifferentBoard call must be the direct callback of its own withAdoptedAgentMutationLease call"
  );
});
