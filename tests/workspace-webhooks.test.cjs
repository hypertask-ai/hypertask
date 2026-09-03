const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
let jitiEntryId = 0;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

function loadSettingsRoute(session) {
  const modulePaths = [
    "src/app/api/settings/webhooks/route.ts",
    "src/lib/auth/getSessionUser.ts",
    "src/lib/mcp/webhooks/workspaceManagement.ts",
  ];
  for (const relativePath of modulePaths) {
    delete require.cache[path.join(root, relativePath)];
  }

  const calls = [];
  class WorkspaceWebhookError extends Error {
    constructor(message, status = 400, field) {
      super(message);
      this.status = status;
      this.field = field;
    }
  }
  stubModule("src/lib/auth/getSessionUser.ts", {
    getSessionUser: async () => session,
  });
  const operation = (name) => async () => {
    calls.push(name);
    return { success: true };
  };
  stubModule("src/lib/mcp/webhooks/workspaceManagement.ts", {
    WorkspaceWebhookError,
    createWorkspaceWebhook: operation("create"),
    deleteWorkspaceWebhook: operation("delete"),
    listWorkspaceWebhooks: operation("list"),
    retryWorkspaceWebhook: operation("retry"),
    rotateWorkspaceWebhookSecret: operation("rotate"),
    setWorkspaceWebhookActive: operation("active"),
    testWorkspaceWebhook: operation("test"),
  });
  const jiti = require("jiti")(
    path.join(root, `tests/jiti-workspace-webhooks-${++jitiEntryId}.cjs`),
    {
      alias: { "@": path.join(root, "src") },
      cache: false,
      interopDefault: true,
    },
  );
  return {
    ...jiti(path.join(root, "src/app/api/settings/webhooks/route.ts")),
    calls,
  };
}

function loadDeniedWorkspaceService() {
  const modulePaths = [
    "src/lib/prisma.ts",
    "src/lib/mcp/webhooks/outbox.ts",
    "src/lib/mcp/webhooks/ssrfGuard.ts",
    "src/lib/mcp/webhooks/workspaceManagement.ts",
  ];
  for (const relativePath of modulePaths) {
    delete require.cache[path.join(root, relativePath)];
  }

  let ownerLookups = 0;
  let prisma;
  prisma = new Proxy(
    {
      team: {
        findFirst: async () => {
          ownerLookups += 1;
          return null;
        },
      },
    },
    {
      get(target, property) {
        if (property === "default") return prisma;
        if (property in target) return target[property];
        throw new Error(`Unexpected database access: ${String(property)}`);
      },
    },
  );
  stubModule("src/lib/prisma.ts", { default: prisma });
  stubModule("src/lib/mcp/webhooks/outbox.ts", {
    createBoardWebhookTestDelivery: async () => {
      throw new Error("Unexpected delivery creation");
    },
    retryBoardWebhookDelivery: async () => {
      throw new Error("Unexpected delivery retry");
    },
  });
  stubModule("src/lib/mcp/webhooks/ssrfGuard.ts", {
    assertSafeWebhookTarget: async () => {
      throw new Error("Unexpected URL validation");
    },
  });
  const jiti = require("jiti")(
    path.join(root, `tests/jiti-workspace-webhooks-${++jitiEntryId}.cjs`),
    {
      alias: { "@": path.join(root, "src") },
      cache: false,
      interopDefault: true,
    },
  );
  return {
    module: jiti(path.join(root, "src/lib/mcp/webhooks/workspaceManagement.ts")),
    ownerLookups: () => ownerLookups,
  };
}

function mutationRequest(method, origin) {
  return new NextRequest("https://app.hypertask.ai/api/settings/webhooks", {
    method,
    body: JSON.stringify({
      active: true,
      events: ["task.created"],
      id: "endpoint-1",
      teamId: "team-1",
      url: "https://example.test/webhook",
    }),
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
  });
}

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
  assert.match(schema, /supportsUnassignedEvent\s+Boolean\s+@default\(false\)/);
  assert.match(
    migration,
    /UNIQUE INDEX "BoardWebhookDelivery_subscriptionId_sourceDeliveryId_manualRetryKey_key"[\s\S]*?WHERE "sourceDeliveryId" IS NOT NULL AND "manualRetryKey" IS NOT NULL/,
  );
});

test("settings mutations require session and same-origin checks", () => {
  const route = read("src/app/api/settings/webhooks/route.ts");

  assert.match(route, /getSessionUser\(request\.headers\)/);
  assert.match(route, /if \(!origin \|\| !host \|\| !protocol\) return false/);
  assert.match(
    route,
    /new URL\(origin\)\.origin === new URL\(`\$\{protocol\}:\/\/\$\{host\}`\)\.origin/,
  );
  for (const method of ["POST", "PATCH", "DELETE"]) {
    const start = route.indexOf(`export async function ${method}`);
    const end = route.indexOf("\nexport async function ", start + 1);
    const body = route.slice(start, end < 0 ? route.length : end);
    assert.match(body, /authorizeMutation\(request\)/, `${method} must enforce origin and login`);
  }
  assert.match(route, /Cache-Control', 'private, no-store'/);
});

test("settings mutations reject missing sessions before calling the service", async () => {
  for (const method of ["POST", "PATCH", "DELETE"]) {
    const route = loadSettingsRoute(null);
    const response = await route[method](
      mutationRequest(method, "https://app.hypertask.ai"),
    );
    assert.equal(response.status, 401, method);
    assert.deepEqual(route.calls, [], method);
  }
});

test("settings mutations reject cross-origin requests before calling the service", async () => {
  for (const method of ["POST", "PATCH", "DELETE"]) {
    const route = loadSettingsRoute({ userId: 6 });
    const response = await route[method](
      mutationRequest(method, "https://attacker.example"),
    );
    assert.equal(response.status, 403, method);
    assert.deepEqual(route.calls, [], method);
  }
});

test("settings mutations reject a matching host on the wrong scheme", async () => {
  const route = loadSettingsRoute({ userId: 6 });
  const response = await route.POST(
    mutationRequest("POST", "http://app.hypertask.ai"),
  );
  assert.equal(response.status, 403);
  assert.deepEqual(route.calls, []);
});

test("every workspace operation stops at the owner boundary", async () => {
  const denied = loadDeniedWorkspaceService();
  const base = { userId: 9, teamId: "another-team", id: "endpoint-1" };
  const operations = [
    () => denied.module.listWorkspaceWebhooks(base),
    () =>
      denied.module.createWorkspaceWebhook({
        ...base,
        events: ["task.created"],
        projectId: null,
        url: "https://example.test/webhook",
      }),
    () => denied.module.setWorkspaceWebhookActive({ ...base, active: true }),
    () => denied.module.rotateWorkspaceWebhookSecret(base),
    () => denied.module.testWorkspaceWebhook(base),
    () =>
      denied.module.retryWorkspaceWebhook({
        ...base,
        deliveryId: "delivery-1",
        idempotencyKey: "retry-1",
      }),
    () => denied.module.deleteWorkspaceWebhook(base),
  ];

  for (const operation of operations) {
    await assert.rejects(operation, (error) => {
      assert.equal(error.status, 403);
      return true;
    });
  }
  assert.equal(denied.ownerLookups(), operations.length);
});

test("workspace management is owner-scoped and agent rows have no mutation path", () => {
  const service = read("src/lib/mcp/webhooks/workspaceManagement.ts");
  const mcpRoute = read("src/app/api/mcp/webhooks/route.ts");

  assert.match(service, /where: \{ id: teamId, googleAccount: \{ userId \} \}/);
  assert.match(service, /OR: \[\{ teamId, projectId: null \}, \{ project: \{ teamId \} \}\]/);
  assert.match(service, /where: \{ id: projectId, teamId: input\.teamId \}/);
  assert.match(service, /\^\[1-9\]\\d\*\$\/\.test\(input\.projectId\)/);
  assert.match(service, /supportsUnassignedEvent: true/);
  assert.match(mcpRoute, /supportsUnassignedEvent: true/);
  assert.match(service, /subscriptionId: subscription\.id,[\s\S]*?idempotencyKey,/);
  assert.match(service, /agent:[\s\S]*?userId: input\.userId[\s\S]*?members:/);
  assert.match(service, /kind: 'agent' as const/);
  assert.match(
    service,
    /agentWebhookDelivery\.findMany[\s\S]*?payload: \{ path: \['projectId'\], equals: id \}/,
  );
  assert.doesNotMatch(
    service,
    /agentWebhookSubscription\.(create(?:Many)?|update(?:Many)?|upsert|delete(?:Many)?)/,
  );
});

test("accepted Settings surface exposes six filters and read-only agent controls", () => {
  const navigation = read("src/components/Modals/Settings/settingsNavigation.ts");
  const shell = read("src/components/Modals/Settings/SettingsShell.tsx");
  const section = read("src/components/Modals/Settings/WebhooksSection.tsx");
  const eventContract = read("src/lib/mcp/webhooks/events.ts");

  const slackIndex = navigation.indexOf('{ id: "slack", label: "Slack" }');
  const webhooksIndex = navigation.indexOf('{ id: "webhooks", label: "Webhooks" }');
  assert.ok(slackIndex >= 0);
  assert.ok(webhooksIndex >= 0);
  assert.ok(webhooksIndex > slackIndex);
  assert.match(shell, /webhooks: WebhooksSection/);
  for (const event of [
    "task.created",
    "task.updated",
    "task.assigned",
    "task.unassigned",
    "comment.created",
    "comment.mention",
  ]) {
    assert.match(eventContract, new RegExp(`'${event.replace(".", "\\.")}'`));
  }
  assert.match(section, /const EVENTS = WORKSPACE_WEBHOOK_EVENTS/);
  assert.match(section, /How webhooks work/);
  assert.match(section, /Send test/);
  assert.match(section, /Rotate secret/);
  assert.match(section, /Payload/);
  assert.match(section, /Retry/);
  assert.match(section, /Open agent/);
  assert.match(section, /endpoint\.kind === "workspace"/);
  assert.match(section, /const actionRequestRef = useRef\(0\)/);
  assert.match(section, /actionAbortRef\.current\?\.abort\(\)/);
  assert.match(
    section,
    /actionRequestRef\.current === token && teamIdRef\.current === requestTeamId/,
  );
  assert.match(section, /signal: controller\.signal/);
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
