const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "src/app/api/mcp/assignees/assign/route.ts"),
  "utf8"
);

test("assignees/assign route adopts a mutation lease before writing, like tasks/update and tasks/move", () => {
  assert.match(
    source,
    /import \{ withAgentMutationLeaseAdoption \} from "@\/lib\/mcp\/tasks\/agentMutationLeaseAdoption";/
  );

  // Every assigneesAssign call site must be the direct callback of a
  // withAgentMutationLeaseAdoption(...) call, or an agent that never called
  // POST /mcp/tasks/lease/claim gets rejected with "Caller holds no agent
  // mutation lease" (HTPR-6185). Matching the wrapper-to-callee adjacency
  // (not just counting occurrences) catches a wrapper hoisted around several
  // calls, or one call site left unwrapped while another is double-wrapped.
  const wrappedCallPattern =
    /withAgentMutationLeaseAdoption\(\s*\{ agentId: ctx\.agentId, userId: currentUser\.id \},\s*\(\)\s*=>[\s\S]{0,40}?assigneesAssign\(/g;
  const assigneesAssignCalls = source.match(/assigneesAssign\(/g) ?? [];
  const wrappedCalls = source.match(wrappedCallPattern) ?? [];

  assert.equal(
    wrappedCalls.length,
    assigneesAssignCalls.length,
    "each assigneesAssign call must be the direct callback of its own withAgentMutationLeaseAdoption call"
  );
});
