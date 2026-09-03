const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("workspace webhook scope is exclusive and delivery attempts are durable", () => {
  const schema = read("src/prisma/schema.prisma");
  const migration = read(
    "src/prisma/migrations/20260903133000_add_workspace_webhook_management/migration.sql",
  );

  assert.match(schema, /model WebhookSubscription[\s\S]*?projectId\s+Int\?[\s\S]*?teamId\s+String\?/);
  assert.match(
    migration,
    /CHECK \(\("projectId" IS NOT NULL\)::integer \+ \("teamId" IS NOT NULL\)::integer = 1\)/,
  );
  assert.match(schema, /model BoardWebhookAttempt[\s\S]*?durationMs\s+Int/);
  assert.match(schema, /@@unique\(\[deliveryId, attemptNumber\]\)/);
  assert.match(schema, /payloadBody\s+String\?[\s\S]*?payloadHash\s+String\?/);
});

test("settings mutations require session and same-origin checks", () => {
  const route = read("src/app/api/settings/webhooks/route.ts");

  assert.match(route, /getSessionUser\(request\.headers\)/);
  assert.match(route, /if \(!origin \|\| !host\) return false/);
  assert.match(route, /new URL\(origin\)\.host === host/);
  for (const method of ["POST", "PATCH", "DELETE"]) {
    const start = route.indexOf(`export async function ${method}`);
    const end = route.indexOf("\nexport async function ", start + 1);
    const body = route.slice(start, end < 0 ? route.length : end);
    assert.match(body, /authorizeMutation\(request\)/, `${method} must enforce origin and login`);
  }
  assert.match(route, /Cache-Control', 'private, no-store'/);
});

test("workspace management is owner-scoped and agent rows have no mutation path", () => {
  const service = read("src/lib/mcp/webhooks/workspaceManagement.ts");

  assert.match(service, /where: \{ id: teamId, googleAccount: \{ userId \} \}/);
  assert.match(service, /OR: \[\{ teamId, projectId: null \}, \{ project: \{ teamId \} \}\]/);
  assert.match(service, /where: \{ id: projectId, teamId: input\.teamId \}/);
  assert.match(service, /agent:[\s\S]*?userId: input\.userId[\s\S]*?members:/);
  assert.match(service, /kind: 'agent' as const/);
  assert.match(
    service,
    /agentWebhookDelivery\.findMany[\s\S]*?payload: \{ path: \['projectId'\], equals: id \}/,
  );
  assert.doesNotMatch(service, /agentWebhookSubscription\.(update|delete)/);
});

test("accepted Settings surface exposes six filters and read-only agent controls", () => {
  const navigation = read("src/components/Modals/Settings/settingsNavigation.ts");
  const shell = read("src/components/Modals/Settings/SettingsShell.tsx");
  const section = read("src/components/Modals/Settings/WebhooksSection.tsx");

  assert.ok(
    navigation.indexOf('{ id: "webhooks", label: "Webhooks" }') >
      navigation.indexOf('{ id: "slack", label: "Slack" }'),
  );
  assert.match(shell, /webhooks: WebhooksSection/);
  for (const event of [
    "task.created",
    "task.updated",
    "task.assigned",
    "task.unassigned",
    "comment.created",
    "comment.mention",
  ]) {
    assert.match(section, new RegExp(`"${event.replace(".", "\\.")}"`));
  }
  assert.match(section, /How webhooks work/);
  assert.match(section, /Send test/);
  assert.match(section, /Rotate secret/);
  assert.match(section, /Payload/);
  assert.match(section, /Retry/);
  assert.match(section, /Open agent/);
  assert.match(section, /endpoint\.kind === "workspace"/);
});

test("new mention and unassignment events are persisted at their domain transactions", () => {
  const assignments = read("src/utils/controllers/assignees/assign.ts");
  const comments = read("src/utils/controllers/comments/createCommentService.ts");

  assert.equal(
    (assignments.match(/const unassignedEvent: WebhookDelivery = \{\s*event: "task\.unassigned"/g) ?? []).length,
    2,
  );
  assert.match(
    comments,
    /if \(mentionedAgentIds\.length > 0\)[\s\S]*?event: "comment\.mention"[\s\S]*?persistBoardWebhookEvents/,
  );
});
