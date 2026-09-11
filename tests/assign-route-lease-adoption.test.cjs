const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "src/app/api/mcp/assignees/assign/route.ts"),
  "utf8"
);

test("assignees/assign adopts a mutation lease and releases it after the write (HTPR-6388)", () => {
  assert.match(
    source,
    /import \{ withAdoptedAgentMutationLease \} from "@\/lib\/mcp\/tasks\/agentMutationLeaseAdoption";/
  );
  assert.doesNotMatch(
    source,
    /withAgentMutationLeaseAdoption/
  );

  // Every assigneesAssign call site must be the direct callback of a
  // withAdoptedAgentMutationLease(prisma, ...) call. That helper adopts for
  // the request and releases the exact token afterward, so the assigned
  // worker can claim immediately instead of waiting for TTL expiry.
  // Matching wrapper-to-callee adjacency catches a wrapper hoisted around
  // several calls, or one call site left on the non-releasing helper.
  const wrappedCallPattern =
    /withAdoptedAgentMutationLease\(\s*prisma,\s*\{ agentId: ctx\.agentId, userId: currentUser\.id \},\s*\(\)\s*=>[\s\S]{0,40}?assigneesAssign\(/g;
  const assigneesAssignCalls = source.match(/assigneesAssign\(/g) ?? [];
  const wrappedCalls = source.match(wrappedCallPattern) ?? [];

  assert.equal(
    wrappedCalls.length,
    assigneesAssignCalls.length,
    "each assigneesAssign call must be the direct callback of its own withAdoptedAgentMutationLease call"
  );
});
