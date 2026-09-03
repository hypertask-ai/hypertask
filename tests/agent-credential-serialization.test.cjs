const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const createJiti = require("jiti");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
});
const {
  projectPublicAgent,
  publicAgentSelect,
  sanitizeAgentCredentials,
} = jiti(path.join(root, "src/lib/agents/publicAgent.ts"));

const credentialBearingAgent = {
  id: "agent-1",
  userId: 6,
  displayName: "Release Agent",
  photoURL: null,
  createdAt: new Date("2026-08-11T00:00:00.000Z"),
  revokedAt: null,
  runtimeType: "EXTERNAL",
  heartbeatAt: null,
  permissions: { role: "write" },
  mcpToken: "eyJ.secret.signature",
  mcpTokenExpiresAt: null,
  prompt: "private instructions",
};

test("the public Agent projection is an allowlist with no credentials", () => {
  assert.equal("mcpToken" in publicAgentSelect, false);
  assert.equal("mcpTokenExpiresAt" in publicAgentSelect, false);
  assert.equal("prompt" in publicAgentSelect, false);

  const projected = projectPublicAgent(credentialBearingAgent);
  assert.equal(projected.id, "agent-1");
  assert.equal(projected.displayName, "Release Agent");
  assert.equal("mcpToken" in projected, false);
  assert.equal("prompt" in projected, false);
});

test("historical activity JSON cannot serialize nested Agent credentials", () => {
  const sanitized = sanitizeAgentCredentials({
    agent: credentialBearingAgent,
    activity: {
      data: {
        fromAgent: credentialBearingAgent,
        toAgent: credentialBearingAgent,
        unexpected: { mcpToken: "eyJ.other.signature", value: "kept" },
      },
    },
  });
  const serialized = JSON.stringify(sanitized);

  assert.doesNotMatch(serialized, /mcpToken|private instructions|eyJ\./);
  assert.match(serialized, /Release Agent/);
  assert.match(serialized, /"value":"kept"/);
});

test("task-detail SQL selects public actors and sanitizes historical activity", () => {
  const source = read("src/utils/controllers/taskDetail/load.ts");

  assert.match(source, /const publicCommentAgent = \(userId: number\) => Prisma\.sql/);
  assert.match(source, /hiddenCommentAgent\(userId\)/);
  assert.match(source, /'displayName', agent\."displayName"/);
  assert.doesNotMatch(source, /to_jsonb\(agent\)/);
  assert.match(source, /sanitizeAgentCredentials\(comments\)/);
  assert.match(source, /agent: \{ select: publicAgentSelect \}/);
});

test("new activity rows are sanitized before Prisma persistence", () => {
  const source = read("src/utils/controllers/activities/createActivity.ts");

  assert.match(source, /safeActivityBody = sanitizeAgentCredentials\(activityBody\)/);
  assert.match(source, /activity: safeActivityBody/);
});

test("public task and board serializers never include whole Agent rows", () => {
  const surfaces = [
    "src/pages/api/members/getAllForAssignees.ts",
    "src/utils/controllers/members/getAll.ts",
    "src/utils/controllers/agents/boardMembers.ts",
    "src/utils/controllers/assignees/getAll.ts",
    "src/utils/controllers/tasks/recentTasks.ts",
    "src/pages/api/favorites/getFavorites.ts",
    "src/utils/controllers/projects/getAllIncludes.ts",
    "src/utils/controllers/assignees/assign.ts",
  ];

  for (const surface of surfaces) {
    const source = read(surface);
    assert.doesNotMatch(source, /\bagent:\s*true\b/, surface);
    assert.match(source, /publicAgentSelect/, surface);
  }
});
