const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const route = read("src/app/api/ai/chat/stream/route.ts");

function loadProfileNormalizer() {
  const source = read("src/utils/controllers/users/updateOwnProfile.ts");
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", "require", javascript)(
    loaded,
    loaded.exports,
    (request) => {
      if (request === "@/lib/prisma") return { default: {} };
      throw new Error(`Unexpected import: ${request}`);
    },
  );
  return loaded.exports;
}

function toolBody(toolName) {
  const start = route.indexOf(`${toolName}: tool({`);
  assert.notEqual(start, -1, `${toolName} tool definition not found`);
  const next = route.indexOf("\n    hypertask_", start + 1);
  return route.slice(start, next === -1 ? undefined : next);
}

test("AI Chat time reports reuse the access-scoped report controller", () => {
  const body = toolBody("hypertask_time_report");

  assert.match(route, /hypertask_time_report: "Reading time entries\.\.\."/);
  assert.match(body, /team_id:/);
  assert.match(body, /board_id:/);
  assert.match(body, /task_id:/);
  assert.match(body, /ticket_number:/);
  assert.match(body, /unique_index:/);
  assert.match(body, /project_id:/);
  assert.match(body, /user:/);
  assert.match(body, /from:/);
  assert.match(body, /to:/);
  assert.match(body, /running_only:/);
  assert.match(body, /resolveTaskForTool\(user, input\)/);
  assert.match(body, /const entries = await listReport\(user\.id, \{/);
  assert.match(body, /input\.user === "me"\s*\? user\.id/);
});

test("AI Chat profile updates share the MCP write path and preserve profile-set flags", () => {
  const body = toolBody("hypertask_update_profile");
  const controller = read(
    "src/utils/controllers/users/updateOwnProfile.ts",
  );
  const mcpRoute = read("src/app/api/mcp/user/profile/route.ts");

  assert.match(body, /inputSchema: getUpdateProfileInputSchema\(\)/);
  assert.match(body, /if \(actingAgentId\)/);
  assert.match(body, /await updateOwnProfile\(user\.id, input\)/);
  assert.match(mcpRoute, /await updateOwnProfile\(user\.id, \{/);
  assert.match(controller, /photoSet: photoURL !== undefined/);
  assert.match(controller, /nameSet: displayName !== undefined/);
  assert.match(controller, /return prisma\.\$transaction\(async \(tx\) => \{/);
});

test("the shared profile validator normalizes safe fields and rejects unsafe values", () => {
  const { normalizeOwnProfileUpdate } = loadProfileNormalizer();

  assert.deepEqual(normalizeOwnProfileUpdate({ displayName: "  Ada  " }), {
    displayName: "Ada",
    photoURL: undefined,
  });
  assert.deepEqual(
    normalizeOwnProfileUpdate({ photoURL: " https://files.example/avatar.png " }),
    { displayName: undefined, photoURL: "https://files.example/avatar.png" },
  );
  assert.throws(
    () => normalizeOwnProfileUpdate({ displayName: "<Ada>" }),
    /must not contain/,
  );
  assert.throws(
    () => normalizeOwnProfileUpdate({ photoURL: "javascript:alert(1)" }),
    /valid http\(s\) URL/,
  );
  assert.throws(() => normalizeOwnProfileUpdate({}), /At least one/);
});

test("AI Chat gets complete reports and confirms exact deletion across messages", () => {
  const getBody = toolBody("hypertask_get_report");
  const deleteBody = toolBody("hypertask_delete_report");

  assert.match(getBody, /await getReport\(\{/);
  assert.match(getBody, /agentId: actingAgentId/);
  assert.match(getBody, /body_html: report\.bodyHtml/);
  assert.match(deleteBody, /const existing = await getReport\(\{/);
  assert.match(deleteBody, /buildBulkOperationKey\("delete-report"/);
  assert.match(deleteBody, /await requireCrossMessageConfirmation\(\{/);
  assert.match(deleteBody, /confirmed: input\.confirmed/);
  assert.match(deleteBody, /confirmation_required: true/);
  assert.match(deleteBody, /const deleted = await deleteReport\(\{/);
  assert.ok(
    deleteBody.indexOf("confirmation_required: true") <
      deleteBody.indexOf("const deleted = await deleteReport({"),
    "deletion must remain after the cross-message preview return",
  );
});

test("new mutations are included in the AI Chat write summary", () => {
  const start = route.indexOf("const writeToolNames = new Set([");
  const end = route.indexOf("]);", start);
  const names = route.slice(start, end);

  assert.match(names, /"hypertask_update_profile"/);
  assert.match(names, /"hypertask_delete_report"/);
  assert.doesNotMatch(names, /"hypertask_time_report"/);
  assert.doesNotMatch(names, /"hypertask_get_report"/);
});
