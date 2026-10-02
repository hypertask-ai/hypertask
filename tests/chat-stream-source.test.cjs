const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const catalog = path.join(root, "src/lib/ai/tools/index.ts");
const helper = path.join(root, "tests/helpers/chat-stream-source.cjs");
const route = path.join(root, "src/app/api/ai/chat/stream/route.ts");

function checkCatalogMutation(before, after, assertion) {
  assert.ok(fs.readFileSync(catalog, "utf8").includes(before));
  const result = spawnSync(process.execPath, ["-e", `
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    const read = fs.readFileSync;
    fs.readFileSync = function(file, options) {
      const text = read.call(this, file, options);
      return file === ${JSON.stringify(catalog)}
        ? text.replace(${JSON.stringify(before)}, ${JSON.stringify(after)})
        : text;
    };
    const source = () => require(${JSON.stringify(helper)}).readFileSync(${JSON.stringify(route)}, "utf8");
    ${assertion}
  `], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("source-level tool assertions follow registration, not unused imports", () => {
  const source = require("./helpers/chat-stream-source.cjs").readFileSync(route, "utf8");
  assert.match(source, /hypertask_board_config: tool\(\{/);
  checkCatalogMutation(
    "hypertask_board_config: createBoardConfigTool(context).hypertask_board_config,",
    "",
    'assert.doesNotMatch(source(), /hypertask_board_config: tool\\(\\{/);',
  );
});

test("source-level tool assertions reject a different selected tool property", () => {
  checkCatalogMutation(
    "hypertask_board_config: createBoardConfigTool(context).hypertask_board_config,",
    "hypertask_board_config: createBoardConfigTool(context).hypertask_create_board,",
    'assert.throws(source, /Invalid chat tool registration/);',
  );
});

test("source-level tool assertions reject changed factory context", () => {
  checkCatalogMutation(
    "hypertask_update_task: createUpdateTaskTool(context).hypertask_update_task,",
    "hypertask_update_task: createUpdateTaskTool({ ...context, user: undefined }).hypertask_update_task,",
    'assert.throws(source, /Invalid chat tool registration/);',
  );
});
