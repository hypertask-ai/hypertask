const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "src/lib/mcp/operations/assignees/assign/operation.ts"),
  "utf8"
);

test("assignees/assign adopts a mutation lease and releases it after the write (HTPR-6388)", () => {
  assert.match(
    source,
    /import \{ [^\n]*withMcpRouteMutationLease as withAdoptedAgentMutationLease[^\n]* \} from '@\/lib\/mcp\/routeWrapper'/
  );
  assert.doesNotMatch(
    source,
    /withAgentMutationLeaseAdoption/
  );

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
