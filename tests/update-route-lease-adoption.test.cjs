const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "src/app/api/mcp/tasks/update/route.ts"),
  "utf8"
);

test("tasks/update adopts a mutation lease and releases it after the write (HTPR-6394)", () => {
  assert.match(
    source,
    /import \{ withAdoptedAgentMutationLease \} from '@\/lib\/mcp\/tasks\/agentMutationLeaseAdoption'/
  );
  assert.match(source, /import prisma from '@\/lib\/prisma'/);
  assert.doesNotMatch(source, /withAgentMutationLeaseAdoption/);

  // The update write must be the direct callback of withAdoptedAgentMutationLease.
  // That helper adopts for the request and releases the exact token afterward,
  // so a following exclusive claim does not wait for TTL expiry after a CLI
  // column move (POST /mcp/tasks/update).
  const wrappedCallPattern =
    /withAdoptedAgentMutationLease\(\s*prisma,\s*\{ agentId: ctx\.agentId, userId: ctx\.user\.id \},\s*\(\)\s*=>[\s\S]{0,40}?executeTaskUpdate\(/g;
  const updateCalls = source.match(/executeTaskUpdate\(/g) ?? [];
  const wrappedCalls = source.match(wrappedCallPattern) ?? [];

  assert.equal(
    wrappedCalls.length,
    updateCalls.length,
    "each executeTaskUpdate call must be the direct callback of its own withAdoptedAgentMutationLease call"
  );
});
