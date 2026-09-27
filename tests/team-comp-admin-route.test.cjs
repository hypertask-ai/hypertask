// HTPR-6653: only the owner can comp a team, and every change is logged in the
// same transaction as the update.
const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
const routePath = "src/app/api/mcp/admin/team-comp/route.ts";

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

const OWNER = { id: 6, email: "valentin.yeo@gmail.com" };
const TEAM_ID = "11111111-1111-4111-8111-111111111111";
let context;
let flagOn;
let teams;
let transactions;

stubModule("src/lib/mcp/auth.ts", {
  checkMcpRateLimit: async () => null,
  validateManagementOrSessionAuth: async () => context,
  createUnauthorizedResponse: () => Response.json({ success: false }, { status: 401 }),
});
stubModule("src/lib/flags.ts", {
  HTPR_6653_ADMIN_TEAM_COMP_FLAG: "htpr-6653-admin-team-comp",
  isFeatureEnabled: async () => flagOn,
});
stubModule("src/lib/prisma.ts", {
  default: {
    user: { findMany: async () => [{ id: 50 }] },
    team: {
      findUnique: async ({ where }) => teams.find((t) => t.id === where.id) ?? null,
      findMany: async () => teams,
      update: ({ where, data }) => ({ op: "team.update", where, data }),
    },
    logs: { create: ({ data }) => ({ op: "logs.create", data }) },
    $transaction: async (ops) => {
      transactions.push(ops);
      const update = ops.find((op) => op.op === "team.update");
      const current = teams.find((t) => t.id === update.where.id);
      return [{ ...current, ...update.data }, { id: 1 }];
    },
  },
});

const jiti = require("jiti")(path.join(root, "tests/team-comp-admin-route.test.cjs"), {
  alias: { "@": path.join(root, "src") },
  cache: false,
  interopDefault: true,
});
const { POST, DELETE } = jiti(path.join(root, routePath));

function request(method, body) {
  return new NextRequest("https://app.hypertask.ai/api/mcp/admin/team-comp", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const until = () => new Date(Date.now() + 30 * 86_400_000).toISOString();
const serial = { concurrency: false };

test.beforeEach(() => {
  context = { user: OWNER };
  flagOn = true;
  teams = [{ id: TEAM_ID, title: "Partner", compedUntil: null, compedPlan: null }];
  transactions = [];
});

test("non-owner accounts cannot comp a team", serial, async () => {
  context = { user: { id: 7, email: "someone@example.test" } };
  const response = await POST(request("POST", { teamId: TEAM_ID, plan: "Pro", until: until() }));
  assert.equal(response.status, 403);
  assert.equal(transactions.length, 0);
});

test("an impostor with the owner email but another id is rejected", serial, async () => {
  context = { user: { id: 99, email: OWNER.email } };
  const response = await POST(request("POST", { teamId: TEAM_ID, plan: "Pro", until: until() }));
  assert.equal(response.status, 403);
});

test("a team-scoped management key cannot comp, even the owner's", serial, async () => {
  context = { user: OWNER, management: { teamId: TEAM_ID } };
  const response = await POST(request("POST", { teamId: TEAM_ID, plan: "BYOK", until: until() }));
  assert.equal(response.status, 403);
  assert.equal(transactions.length, 0);
});

test("the route stays hidden while its flag is off", serial, async () => {
  flagOn = false;
  const response = await POST(request("POST", { teamId: TEAM_ID, plan: "BYOK", until: until() }));
  assert.equal(response.status, 404);
  assert.equal(transactions.length, 0);
});

test("owner comps a team as BYOK and the change is logged in the same transaction", serial, async () => {
  const response = await POST(request("POST", { teamId: TEAM_ID, plan: "BYOK", until: until() }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.comp.compedPlan, "BYOK");
  assert.equal(body.comp.activeCompPlan, "BYOK");

  assert.equal(transactions.length, 1);
  const [update, log] = transactions[0];
  assert.equal(update.data.compedPlan, "BYOK");
  assert.equal(log.op, "logs.create");
  assert.equal(log.data.type, "Team");
  assert.equal(log.data.LoggedById, OWNER.id);
  assert.match(log.data.log, new RegExp(`${TEAM_ID}.*none -> BYOK until`));
});

test("owner clears a comp and the clear is logged", serial, async () => {
  teams[0] = { ...teams[0], compedPlan: "BYOK", compedUntil: new Date(until()) };
  const response = await DELETE(request("DELETE", { teamId: TEAM_ID }));
  assert.equal(response.status, 200);
  const [update, log] = transactions[0];
  assert.deepEqual(update.data, { compedPlan: null, compedUntil: null });
  assert.match(log.data.log, /BYOK until .* -> none/);
});

test("a past date or unknown plan is rejected", serial, async () => {
  const pastDate = new Date(Date.now() - 1000).toISOString();
  assert.equal((await POST(request("POST", { teamId: TEAM_ID, plan: "Pro", until: pastDate }))).status, 400);
  assert.equal((await POST(request("POST", { teamId: TEAM_ID, plan: "AI", until: until() }))).status, 400);
  assert.equal(transactions.length, 0);
});

test("an email on several teams returns the candidates instead of guessing", serial, async () => {
  teams.push({ id: "22222222-2222-4222-8222-222222222222", title: "Other", compedUntil: null, compedPlan: null });
  const response = await POST(request("POST", { email: "member@example.test", plan: "Pro", until: until() }));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.candidates.length, 2);
  assert.equal(transactions.length, 0);
});
