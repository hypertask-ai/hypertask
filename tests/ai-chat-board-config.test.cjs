// HTPR-5112: AI chat must expose the MCP board_config capability without
// making an authenticated HTTP request back into the same app. This repository
// has no database-backed node:test harness, so the direct-data and authorization
// invariants use source inspection, matching the convention in neighboring tests.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROUTE = path.resolve(
  __dirname,
  "../src/app/api/ai/chat/stream/route.ts",
);
const ACCESS_SERVICE = path.resolve(
  __dirname,
  "../src/app/api/ai/_lib/customInstructions.ts",
);

function toolBody(source, toolName) {
  const start = source.indexOf(`${toolName}: tool({`);
  assert.notEqual(start, -1, `${toolName} tool definition not found`);
  const nextToolStart = source.indexOf("\n    hypertask_", start + 1);
  return source.slice(start, nextToolStart === -1 ? undefined : nextToolStart);
}

test("hypertask_board_config uses direct data access without minting an MCP token", () => {
  const source = fs.readFileSync(ROUTE, "utf8");
  const body = toolBody(source, "hypertask_board_config");

  assert.match(
    source,
    /hypertask_board_config: "Managing board AI configuration\.\.\."/,
    "tool must have a user-visible status label",
  );
  assert.match(body, /sendStatus\("hypertask_board_config"\)/);
  assert.match(
    body,
    /execute: withToolErrors\(async \(input\) => \{/,
    "tool failures must use the neighboring { success: false, error } convention",
  );
  assert.doesNotMatch(source, /\bcreateMcpToken\b/);
  assert.doesNotMatch(source, /\bcreateApiClient\b/);
  assert.doesNotMatch(source, /\bProjectService\b/);
  assert.doesNotMatch(body, /\bfetch\s*\(/);
  assert.doesNotMatch(body, /\/mcp\/projects\//);
  assert.match(body, /parseBoardPlaybook\(\{/);
  assert.match(body, /prisma\.project\.findFirst\(\{/);
  assert.match(body, /prisma\.project\.updateMany\(\{/);
  assert.match(body, /prisma\.aI_Custom_Instructions\.findFirst\(\{/);
  assert.match(body, /prisma\.aI_Custom_Instructions\.update\(\{/);
  assert.match(body, /prisma\.aI_Custom_Instructions\.create\(\{/);
});

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

test("hypertask_board_config checks access before every direct write", () => {
  const source = fs.readFileSync(ROUTE, "utf8");
  const body = toolBody(source, "hypertask_board_config");
  const accessSource = fs.readFileSync(ACCESS_SERVICE, "utf8");

  const accessCheck = "await assertProjectAccess(user.id, input.project_id)";
  assert.notEqual(body.indexOf(accessCheck), -1, "explicit board access check missing");
  for (const write of [
    "prisma.project.updateMany",
    "prisma.aI_Custom_Instructions.update",
    "prisma.aI_Custom_Instructions.create",
  ]) {
    assert.notEqual(body.indexOf(write), -1, `${write} write missing`);
    assert.ok(
      body.indexOf(accessCheck) < body.indexOf(write),
      `access must be checked before ${write}`,
    );
  }
  assert.match(
    accessSource,
    /\.\.\.getProjectWhere\(userId\)/,
    "chat must use the same owner-or-member project predicate as MCP",
  );
  assert.match(
    accessSource,
    /class ProjectAccessError extends Error \{[\s\S]*?super\("Project not found or access denied"\)/,
    "the typed access error must keep the safe refusal message",
  );
  assert.match(
    accessSource,
    /throw new ProjectAccessError\(\)/,
    "inaccessible boards must be refused",
  );
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
