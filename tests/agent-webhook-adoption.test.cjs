const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const { JSDOM } = require("jsdom");
const jitiModule = require("jiti");
const { z } = require("zod");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const jiti = jitiModule.createJiti
  ? jitiModule.createJiti(__filename, {
      alias: { "@": path.join(root, "src") },
      interopDefault: true,
      moduleCache: false,
      jsx: true,
    })
  : jitiModule(__filename, {
      alias: { "@": path.join(root, "src") },
      interopDefault: true,
      cache: false,
      jsx: true,
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
  assert.match(panel, /How webhooks work/);
  assert.match(panel, /href="https:\/\/docs\.hypertask\.ai\/mcp\/agent-webhooks\/"/);
});

test("external agent cards open webhook settings only when requested", async () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const previousNavigator = global.navigator;
  const previousFetch = global.fetch;
  const previousReact = global.React;
  const previousSelf = global.self;
  const previousActEnvironment = global.IS_REACT_ACT_ENVIRONMENT;
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://app.hypertask.ai/agents",
  });
  let webhookRequests = 0;
  let reactRoot;

  try {
    global.window = dom.window;
    global.document = dom.window.document;
    global.navigator = dom.window.navigator;
    global.React = React;
    global.self = dom.window;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    global.fetch = async () => {
      webhookRequests += 1;
      return {
        ok: true,
        json: async () => ({
          success: true,
          subscription: null,
          deliveries: [],
        }),
      };
    };

    const { AgentCard } = jiti(
      path.join(root, "src/app/agents/AgentsRegister.tsx"),
    );
    const container = document.getElementById("root");
    reactRoot = require("react-dom/client").createRoot(container);
    const agent = {
      id: "external-agent",
      slug: "external-agent",
      displayName: "External Agent",
      photoURL: null,
      createdAt: "2026-09-02T12:00:00.000Z",
      revokedAt: null,
      archivedAt: null,
      working: null,
      runtimeType: "EXTERNAL",
      prompt: null,
      modelOptionId: null,
      heartbeatAt: null,
      lastPostedAt: null,
      boards: [{ id: 15, name: "Hypertask Product" }],
    };

    await React.act(async () => {
      reactRoot.render(
        React.createElement(AgentCard, {
          agent,
          pending: false,
          onToggle: () => {},
        }),
      );
    });

    const plug = container.querySelector(
      'button[aria-label="Configure webhook for External Agent"]',
    );
    assert.ok(plug, "external agents should expose webhook settings");
    assert.equal(webhookRequests, 0, "the collapsed panel must not fetch");

    await React.act(async () => plug.click());
    assert.equal(webhookRequests, 1);
    assert.match(container.textContent, /Wake this agent without polling/);
    assert.equal(dom.window.location.pathname, "/agents");

    await React.act(async () => plug.click());
    assert.doesNotMatch(container.textContent, /Wake this agent without polling/);
    assert.equal(webhookRequests, 1);
    assert.equal(dom.window.location.pathname, "/agents");

    await React.act(async () => plug.click());
    assert.equal(webhookRequests, 2);
    assert.match(container.textContent, /Wake this agent without polling/);

    await React.act(async () => {
      reactRoot.render(
        React.createElement(AgentCard, {
          agent: { ...agent, id: "native-agent", runtimeType: "NATIVE" },
          pending: false,
          onToggle: () => {},
        }),
      );
    });
    assert.equal(container.querySelector('button[aria-label^="Configure webhook"]'), null);
    assert.doesNotMatch(container.textContent, /Wake this agent without polling/);
    assert.equal(webhookRequests, 2);
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    dom.window.close();
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
    if (previousNavigator === undefined) delete global.navigator;
    else global.navigator = previousNavigator;
    if (previousFetch === undefined) delete global.fetch;
    else global.fetch = previousFetch;
    if (previousReact === undefined) delete global.React;
    else global.React = previousReact;
    if (previousSelf === undefined) delete global.self;
    else global.self = previousSelf;
    if (previousActEnvironment === undefined) {
      delete global.IS_REACT_ACT_ENVIRONMENT;
    } else {
      global.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  }
});
