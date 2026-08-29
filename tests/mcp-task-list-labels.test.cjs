const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const routeSource = fs.readFileSync(
  path.join(root, "src/app/api/mcp/tasks/route.ts"),
  "utf8",
);
const mapperPath = path.join(root, "src/lib/mcp/tasks/mappers.ts");
const mapperSource = fs.readFileSync(mapperPath, "utf8");

function loadMappers() {
  const javascript = ts.transpileModule(mapperSource, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  const stubs = {
    "@/lib/mcp/agents": {
      mapMcpAgent: () => undefined,
      mcpAgentSelect: {},
    },
    "@/lib/staleness": {
      taskStaleness: () => ({}),
    },
  };
  const loaded = new Module(mapperPath);
  loaded.filename = mapperPath;
  loaded.require = (request) => stubs[request] ?? require(request);
  loaded._compile(javascript, mapperPath);
  return loaded.exports;
}

test("the MCP task list selects labels in the paginated task query", () => {
  const listQueryStart = routeSource.indexOf("// Get tasks");
  const listQueryEnd = routeSource.indexOf("// Get metadata counts");
  assert.notEqual(listQueryStart, -1);
  assert.notEqual(listQueryEnd, -1);

  const listQuery = routeSource.slice(listQueryStart, listQueryEnd);
  assert.match(
    listQuery,
    /taskLabels:\s*{\s*select:\s*{\s*label:\s*{\s*select:\s*mcpTaskLabelSelect/,
  );
  assert.match(
    routeSource,
    /labels:\s*task\.taskLabels\.map\(mapMcpTaskLabel\)/,
  );
});

test("list and detail labels share the exact id/name mapping", () => {
  const { mapMcpTaskLabel, mapTaskToMcpGetResponse } = loadMappers();
  const taskLabels = [
    { label: { id: "label-1", value: "Bug" } },
    { label: { id: "label-2", value: null } },
  ];

  const listLabels = taskLabels.map(mapMcpTaskLabel);
  const detail = mapTaskToMcpGetResponse({
    id: 5063,
    uniqueIndex: 5063,
    projectId: 15,
    title: "List labels",
    section: "In Progress",
    status: "Normal",
    project: { title: "Hypertask Product" },
    taskLabels,
    assignees: [],
    followers: [],
    attachments: [],
    customFieldValues: [],
    subTasks: [],
    _count: { comments: 0 },
    createdAt: new Date("2026-08-07T00:00:00.000Z"),
    updatedAt: new Date("2026-08-07T00:00:00.000Z"),
  });

  assert.deepEqual(listLabels, [
    { id: "label-1", name: "Bug" },
    { id: "label-2", name: "" },
  ]);
  assert.deepEqual(detail.labels, listLabels);
  assert.deepEqual(Object.keys(listLabels[0]).sort(), ["id", "name"]);
});
