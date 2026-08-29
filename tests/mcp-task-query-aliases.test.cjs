const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const routeSource = fs.readFileSync(
  path.join(root, "src/app/api/mcp/tasks/route.ts"),
  "utf8",
);

function extractFunction(name, nextName) {
  const start = routeSource.indexOf(`function ${name}`);
  const end = routeSource.indexOf(`function ${nextName}`, start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return routeSource.slice(start, end);
}

function loadParser() {
  const source = [
    extractFunction("parseIntegerParam", "validationError"),
    "function validationError(message: string) { return { message }; }",
    extractFunction("parsePositiveIntegerParam", "parseNonNegativeIntegerParam"),
    "module.exports = { parsePositiveIntegerParam };",
  ].join("\n");
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", "URLSearchParams", javascript)(
    loaded,
    loaded.exports,
    URLSearchParams,
  );
  return loaded.exports.parsePositiveIntegerParam;
}

test("MCP task list accepts project as a project_id alias", () => {
  const parse = loadParser();
  const result = parse(
    new URLSearchParams({ project: "2108" }),
    "project_id",
    ["projectId", "project"],
  );

  assert.deepEqual(result, { ok: true, value: 2108 });
  assert.match(
    routeSource,
    /parsePositiveIntegerParam\([\s\S]*?'project_id',[\s\S]*?\['projectId', 'project'\]/,
  );
});

test("canonical project_id wins over compatibility aliases", () => {
  const parse = loadParser();
  const result = parse(
    new URLSearchParams({ project_id: "15", projectId: "339", project: "2108" }),
    "project_id",
    ["projectId", "project"],
  );

  assert.deepEqual(result, { ok: true, value: 15 });
});

test("an invalid project alias fails instead of dropping the filter", () => {
  const parse = loadParser();
  const result = parse(
    new URLSearchParams({ project: "not-a-board" }),
    "project_id",
    ["projectId", "project"],
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.response, {
    message: "project_id must be a positive integer",
  });
});
