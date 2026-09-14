const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const compile = (file) =>
  ts.transpileModule(read(file), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

test("assignee lookup status filter: unassign allows any status, assign stays Normal (HTPR-6428)", () => {
  const mod = { exports: {} };
  new Function("module", "exports", "require", compile("src/lib/mcp/tasks/activeTaskMutation.ts"))(
    mod,
    mod.exports,
    require,
  );
  const {
    ACTIVE_TASK_MUTATION_STATUS,
    assigneeLookupStatusFilter,
  } = mod.exports;

  assert.equal(assigneeLookupStatusFilter("assign"), ACTIVE_TASK_MUTATION_STATUS);
  assert.equal(assigneeLookupStatusFilter("assign"), "Normal");
  assert.equal(assigneeLookupStatusFilter("unassign"), undefined);

  // Route wires the helper for both intents.
  const route = read("src/app/api/mcp/assignees/assign/route.ts");
  assert.match(route, /assigneeLookupStatusFilter/);
  assert.match(
    route,
    /allowNonNormalStatus:\s*assignIntent\s*===\s*"unassign"/,
  );

  console.log("assign still requires Normal");
});
