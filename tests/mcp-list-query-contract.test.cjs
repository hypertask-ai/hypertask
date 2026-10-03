const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

test("list query fields are always merged without an infra flag", () => {
  const taskValidation = read("src/lib/mcp-server/validations/task.validation.ts");
  const handler = read("src/lib/mcp-server/handler.ts");
  const contract = read("src/lib/mcp-server/listQueryContract.ts");
  const listQuerySchema = read("src/lib/mcp-server/validations/common/listQuery.ts");

  assert.match(listQuerySchema, /SchemaWithListQuery/);
  assert.doesNotMatch(listQuerySchema, /if \(!options\?\.listQuery\)/);
  assert.match(taskValidation, /withListQuerySchema\(listTasksBaseSchema\)/);
  assert.match(contract, /getListTasksInputSchema\(\)/);
  assert.match(handler, /resolvePortableTools\(MCP_TOOLS as PortableTool\[\]\)/);
  assert.doesNotMatch(handler, /isFeatureEnabled|authenticatedMcpHandler|authenticatedListQueryHandler/);
});

test("routes return nextCursor and project after building link", () => {
  const tasks = read("src/app/api/mcp/tasks/route.ts");
  const search = read("src/app/api/mcp/tasks/search/route.ts");
  const comments = read("src/app/api/mcp/comments/route.ts");
  const projects = read("src/app/api/mcp/projects/route.ts");
  const sections = read("src/app/api/mcp/projects/[projectId]/sections/route.ts");
  const labels = read("src/app/api/mcp/projects/[projectId]/labels/route.ts");
  const taskService = read("src/lib/mcp-server/lib/services/task.service.ts");
  const searchService = read("src/lib/mcp-server/lib/services/search.service.ts");

  assert.match(tasks, /withTaskPresentation/);
  assert.doesNotMatch(tasks, /listQueryEnabled/);
  assert.match(tasks, /sort must be one of/);
  assert.match(search, /listQuery\?\.sortBy/);
  assert.match(search, /nextCursor/);
  assert.match(search, /if \(!prWhere\)/);
  assert.match(search, /section \|\|/);
  assert.match(search, /return withTaskPresentation/);
  assert.match(comments, /sort must be createdAt or id/);
  assert.match(comments, /requestedSortOrder/);
  assert.match(projects, /filter\.updated_since/);
  assert.match(projects, /nextCursor/);
  assert.match(sections, /projected\?\.value\.nextCursor/);
  assert.match(labels, /projected\?\.value\.nextCursor/);
  assert.match(taskService, /requestedFields\.length > 0 \|\| task\.link/);
  assert.match(searchService, /requestedFields\.length > 0 \|\| task\.link/);
});

test("label and agent schemas include list fields and keep validation", () => {
  const projectValidation = read("src/lib/mcp-server/validations/project.validation.ts");
  const agentValidation = read("src/lib/mcp-server/validations/agent.validation.ts");
  const listQuery = read("src/lib/mcp/listQuery.ts");

  assert.match(projectValidation, /getListLabelsBaseSchema\(\)/);
  assert.match(agentValidation, /withListQuerySchema\(z\.object\(\{\}\)\)/);
  assert.doesNotMatch(agentValidation, /options\?\.listQuery/);
  assert.match(listQuery, /filter must be a JSON object/);
  assert.match(listQuery, /cursor must be a previous nextCursor value/);
});
