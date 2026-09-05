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

  const assigneesAssignCalls = source.match(/assigneesAssign\(/g) ?? [];
  const adoptedCalls = source.match(/withAgentMutationLeaseAdoption\(/g) ?? [];

  // Every assigneesAssign call site must be wrapped, or an agent that never
  // called POST /mcp/tasks/lease/claim gets rejected with "Caller holds no
  // agent mutation lease" (HTPR-6185).
  assert.equal(
    adoptedCalls.length,
    assigneesAssignCalls.length,
    "each assigneesAssign call must run inside withAgentMutationLeaseAdoption"
  );
});
