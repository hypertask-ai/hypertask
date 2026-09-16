const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

test("list query fields are merged only when the flag is on", () => {
  const taskValidation = read("src/lib/mcp-server/validations/task.validation.ts");
  const handler = read("src/lib/mcp-server/handler.ts");
  const contract = read("src/lib/mcp-server/listQueryContract.ts");
  const listQuerySchema = read("src/lib/mcp-server/validations/common/listQuery.ts");

  assert.match(listQuerySchema, /if \(!options\?\.listQuery\) return schema/);
  assert.match(listQuerySchema, /SchemaWithListQuery/);
  assert.doesNotMatch(listQuerySchema, /return schema\.merge\(extra\) as T/);
  assert.match(taskValidation, /withListQuerySchema\(/);
  assert.match(taskValidation, /getListTasksInputSchema\(options\?: ListQuerySchemaOptions\)/);
  assert.match(taskValidation, /withListQuerySchema\(listTasksBaseSchema, \{ listQuery: true \}\)/);
  assert.match(contract, /getListTasksInputSchema\(\{ listQuery: enabled \}\)/);
  assert.match(handler, /HTPR_6530_MCP_LIST_QUERY_FLAG/);
  assert.match(handler, /resolvePortableTools\(MCP_TOOLS as PortableTool\[\], listQueryEnabled\)/);
  assert.match(handler, /authenticatedListQueryHandler/);
  assert.match(handler, /authenticatedMcpHandler/);
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
  assert.match(tasks, /listQueryEnabled \|\| usesCursor/);
  assert.match(tasks, /sort must be one of/);
  assert.match(search, /listQuery\?\.sortBy/);
  assert.match(search, /nextCursor/);
  assert.match(search, /if \(!prWhere\)/);
  assert.match(search, /section \|\|/);
  assert.match(search, /listQueryEnabled[\s\S]{0,40}withTaskPresentation/);
  assert.match(comments, /sort must be createdAt or id/);
  assert.match(comments, /requestedSortOrder/);
  assert.match(projects, /filter\.updated_since/);
  assert.match(projects, /nextCursor/);
  assert.match(sections, /projected\?\.value\.nextCursor/);
  assert.match(labels, /projected\?\.value\.nextCursor/);
  assert.match(taskService, /requestedFields\.length > 0 \|\| task\.link/);
  assert.match(searchService, /requestedFields\.length > 0 \|\| task\.link/);
});

test("label parse and disabled agent schema keep the flag contract", () => {
  const projectValidation = read("src/lib/mcp-server/validations/project.validation.ts");
  const agentValidation = read("src/lib/mcp-server/validations/agent.validation.ts");
  const listQuery = read("src/lib/mcp/listQuery.ts");

  assert.match(projectValidation, /getListLabelsBaseSchema\(\{ listQuery: true \}\)/);
  assert.match(agentValidation, /if \(!options\?\.listQuery\) return z\.object\(\{\}\)\.strict\(\)/);
  assert.match(listQuery, /filter must be a JSON object/);
  assert.match(listQuery, /cursor must be a previous nextCursor value/);
});
