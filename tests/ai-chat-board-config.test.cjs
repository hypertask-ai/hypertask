const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("./helpers/chat-stream-source.cjs");
const path = require("node:path");

const ROUTE = path.resolve(
  __dirname,
  "../src/app/api/ai/chat/stream/route.ts",
);
function toolBody(source, toolName) {
  const start = source.indexOf(`${toolName}: tool({`);
  assert.notEqual(start, -1, `${toolName} tool definition not found`);
  const nextToolStart = source.indexOf("\n    hypertask_", start + 1);
  return source.slice(start, nextToolStart === -1 ? undefined : nextToolStart);
}

test("hypertask_board_config schema requires an explicit project_id", () => {
  const source = fs.readFileSync(ROUTE, "utf8");
  const body = toolBody(source, "hypertask_board_config");

  assert.match(body, /inputSchema: z\s*\.object\(\{/);
  assert.match(
    body,
    /project_id: z\.coerce\.number\(\)\.int\(\)\.positive\(\),/,
    "project_id must be a required positive board identifier",
  );
  assert.doesNotMatch(
    body,
    /project_id:[^\n]*\.optional\(\)/,
    "project_id must never be inferred from the open board",
  );
  for (const action of [
    "get_playbook",
    "set_playbook",
    "get_instructions",
    "set_instructions",
  ]) {
    assert.match(body, new RegExp(`"${action}"`), `missing ${action} action`);
  }
});

test("hypertask_board_config mirrors MCP storage and response shapes", () => {
  const source = fs.readFileSync(ROUTE, "utf8");
  const body = toolBody(source, "hypertask_board_config");

  assert.match(body, /select: \{ id: true, playbook: true \}/);
  assert.match(body, /data: \{ playbook: parsed\.value as Prisma\.InputJsonValue \}/);
  assert.match(body, /playbook: project\.playbook \?\? null/);
  assert.match(body, /include: \{ attachments: true \}/);
  assert.match(body, /customInstruction: input\.custom_instruction/);
  assert.match(body, /model_selected: modelOption\.id/);
  assert.match(body, /source_selected: modelOption\.source/);
  assert.match(body, /lastUpdatedAt: new Date\(\)/);
  assert.match(body, /return sanitizeForJson\(\{ success: true, instruction \}\)/);
});
