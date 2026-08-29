const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const test = require("node:test");

const workflowPath = ".github/workflows/preview-smoke.yml";

test("preview smoke does not send an app credential to preview code", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /environment_url/);
  assert.match(workflow, /BYPASS: \$\{\{ secrets\.VERCEL_BYPASS_SECRET \}\}/);
  assert.match(workflow, /\npermissions: \{\}\n/);
  assert.match(workflow, /\n    runs-on: ubuntu-latest\n/);
  assert.doesNotMatch(workflow, /HYPERTASK_MCP_TOKEN/);
  assert.doesNotMatch(workflow, /Authorization: Bearer/);
  assert.doesNotMatch(workflow, /\/api\/mcp\/projects/);
});
