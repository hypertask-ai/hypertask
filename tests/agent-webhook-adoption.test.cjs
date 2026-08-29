const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const jitiModule = require("jiti");
const { z } = require("zod");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const jiti = jitiModule.createJiti
  ? jitiModule.createJiti(__filename, {
      alias: { "@": path.join(root, "src") },
      interopDefault: true,
      moduleCache: false,
    })
  : jitiModule(__filename, {
      alias: { "@": path.join(root, "src") },
      interopDefault: true,
      cache: false,
    });

test("agent webhook discovery is complete and test deliveries use the durable queue", () => {
  const events = read("src/lib/agentWebhooks/events.ts");
  const outbox = read("src/lib/agentWebhooks/outbox.ts");
  const api = read("src/app/api/mcp/webhooks/route.ts");

  assert.match(events, /AGENT_WEBHOOK_EVENT_DEFINITIONS/);
  assert.match(events, /signedContent: "<X-Hypertask-Timestamp>\.<raw request body>"/);
  assert.match(events, /documentationUrl: "https:\/\/docs\.hypertask\.ai\/mcp\/agent-webhooks\/"/);
  assert.match(outbox, /event: "webhook\.test"/);
  assert.match(outbox, /queueAgentWebhookDelivery\(deliveryId\)/);
  assert.match(api, /'configure',\s*'test',\s*'replay',\s*'rotate'/);
});

test("MCP, AI Chat, and HyperAI expose the agent webhook contract safely", () => {
  const registry = read("src/lib/mcp-server/tools/index.ts");
  const metadata = read("src/lib/mcp-server/config/tool-metadata.ts");
  const validation = read("src/lib/mcp-server/validations/webhook.validation.ts");
  const aiChat = read("src/app/api/ai/chat/stream/route.ts");
  const hyperAi = read("src/app/api/ai/_lib/hyperAiTools.ts");

  assert.match(registry, /agentWebhookTool/);
  assert.match(metadata, /buildToolName\('agent_webhook'\)/);
  assert.doesNotMatch(
    validation,
    /agent_id:[\s\S]{0,160}\.default\("self"\)/,
    "human MCP credentials must not receive a native-agent-only default",
  );
  assert.match(validation, /Use self with agent credentials/);
  assert.match(aiChat, /hypertask_agent_webhook: tool\(/);
  assert.match(aiChat, /requireAccountManagementConfirmation\(/);
  const writeToolNamesStart = aiChat.indexOf("const writeToolNames = new Set([");
  const writeToolNamesEnd = aiChat.indexOf("]);", writeToolNamesStart);
  assert.match(
    aiChat.slice(writeToolNamesStart, writeToolNamesEnd),
    /"hypertask_agent_webhook"/,
    "every mutating webhook action must cross the heartbeat write boundary",
  );
  assert.match(
    hyperAi,
    /\[TOOL_METADATA\.AGENT_WEBHOOK\.name, new Set\(\["get"\]\)\]/,
  );
  assert.match(hyperAi, /HYPER_AI_SECRET_WEBHOOK_ACTIONS/);
  assert.match(hyperAi, /Signing secrets are never written into ticket comments/);
  assert.match(hyperAi, /rawMcpInput\.agent_id === "self"/);
});

test("first-time configuration and secret rotation are serialized", () => {
  const management = read("src/lib/agentWebhooks/management.ts");

  assert.match(management, /prisma\.\$transaction\(/);
  assert.match(management, /pg_advisory_xact_lock/);
  assert.match(management, /await tx\.\$executeRaw\(/);
  assert.match(management, /SELECT pg_advisory_xact_lock/);
  assert.doesNotMatch(management, /pg_advisory_xact_lock[^`]*(::text|FROM)/);
  const lock = management.indexOf("pg_advisory_xact_lock");
  const readCurrent = management.indexOf(
    "tx.agentWebhookSubscription.findUnique",
    lock,
  );
  const generateSecret = management.indexOf("crypto.randomBytes", readCurrent);
  const writeSubscription = management.indexOf(
    "tx.agentWebhookSubscription.upsert",
    generateSecret,
  );
  assert.ok(lock >= 0 && lock < readCurrent);
  assert.ok(readCurrent < generateSecret && generateSecret < writeSubscription);
});

test("the portable webhook schema remains extendable for HyperAI", () => {
  const { getAgentWebhookInputSchema, AgentWebhookExecutionSchema } = jiti(
    path.join(root, "src/lib/mcp-server/validations/webhook.validation.ts"),
  );

  const projected = getAgentWebhookInputSchema().extend({
    confirmed: z.boolean().optional(),
  });
  assert.equal(
    projected.parse({ action: "get", agent_id: "self" }).agent_id,
    "self",
  );
  assert.throws(
    () =>
      AgentWebhookExecutionSchema.parse({
        action: "replay",
        agent_id: "self",
      }),
    /delivery_id is required for replay/,
  );
});

test("agent settings guide customers to a verified first delivery", () => {
  const panel = read("src/components/Modals/Agent/AgentWebhookPanel.tsx");

  assert.match(panel, /Wake this agent without polling/);
  assert.match(panel, /Save this signing secret now/);
  assert.match(panel, /Send test/);
  assert.match(panel, /Verify signatures and process deliveries/);
  assert.match(panel, /docs\.hypertask\.ai\/mcp\/agent-webhooks/);
});
