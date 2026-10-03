// HTPR-6653: only the owner can comp a team, and every change is logged in the
// same transaction as the update.
const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
const routePath = "src/app/api/admin/team-comp/route.ts";

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

const OWNER = { id: 6, email: "valentin.yeo@gmail.com" };
const TEAM_ID = "11111111-1111-4111-8111-111111111111";
let context;
let teams;
let transactions;
let transactionLock;
let failAudit;

stubModule("src/lib/flags.ts", {
  FEATURE_FLAG_OWNER_USER_ID: 6,
  isFeatureFlagOwner: async () => Boolean(context?.user?.id === OWNER.id &&
    context.user.email === OWNER.email && !context.management),
});
stubModule("src/lib/prisma.ts", {
  default: {
    user: { findMany: async () => [{ id: 50 }] },
    team: {
      findUnique: async ({ where }) => {
        const team = teams.find((t) => t.id === where.id);
        return team ? { ...team } : null;
      },
      findMany: async ({ where }) => {
        if (where.title) return teams.filter((t) => t.title.toLowerCase().includes(where.title.contains.toLowerCase()));
        return teams.filter((t) => where.OR.some((condition) => {
          if (condition.googleAccount) return condition.googleAccount.userId.in.includes(t.googleAccount?.userId);
          const membership = condition.members.some;
          return t.members.some((m) => membership.userId.in.includes(m.userId) &&
            (!membership.status || m.status === membership.status));
        }));
      },
    },
    $transaction: async (callback) => {
      assert.equal(typeof callback, "function");
      const ops = [];
      transactions.push(ops);
      let release;
      let snapshot;
      let locked = false;
      let read = false;
      try {
        return await callback({
          $queryRaw: async (strings, id) => {
            assert.equal(strings.join("?"), 'SELECT "id" FROM "Team" WHERE "id" = ? FOR UPDATE');
            assert.equal(id, TEAM_ID);
            const previous = transactionLock;
            transactionLock = new Promise((resolve) => { release = resolve; });
            await previous;
            locked = true;
            snapshot = teams.map((t) => ({ ...t }));
            return [{ id }];
          },
          team: {
            findUniqueOrThrow: async ({ where }) => {
              assert.equal(locked, true, "lock must precede the audit read");
              const current = teams.find((t) => t.id === where.id);
              assert.ok(current);
              read = true;
              return { ...current };
            },
            update: async ({ where, data }) => {
              assert.equal(read, true, "transaction must re-read before updating");
              ops.push({ op: "team.update", where, data });
              const index = teams.findIndex((t) => t.id === where.id);
              teams[index] = { ...teams[index], ...data };
              return { ...teams[index] };
            },
          },
          logs: { create: async ({ data }) => {
            assert.equal(ops[0]?.op, "team.update");
            if (failAudit) throw new Error("Audit unavailable");
            ops.push({ op: "logs.create", data });
            return { id: 1 };
          } },
        });
      } catch (error) {
        if (snapshot) teams = snapshot;
        throw error;
      } finally {
        release?.();
      }
    },
  },
});

const jiti = require("jiti")(path.join(root, "tests/team-comp-admin-route.test.cjs"), {
  alias: { "@": path.join(root, "src") },
  cache: false,
  interopDefault: true,
});
const { GET, POST, DELETE } = jiti(path.join(root, routePath));
const { setTeamComp } = jiti(path.join(root, "src/lib/teamCompAdmin.ts"));

function request(method, body) {
  return new NextRequest("https://app.hypertask.ai/api/admin/team-comp", {
    method,
    headers: { "content-type": "application/json", origin: "https://app.hypertask.ai", host: "app.hypertask.ai" },
    body: JSON.stringify(body),
  });
}

const until = () => new Date(Date.now() + 30 * 86_400_000).toISOString();
const serial = { concurrency: false };

test.beforeEach(() => {
  context = { user: OWNER };
  teams = [{ id: TEAM_ID, title: "Partner", compedUntil: null, compedPlan: null, members: [{ userId: 50, status: "Accepted" }] }];
  transactions = [];
  transactionLock = Promise.resolve();
  failAudit = false;
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
  teams.push({ id: "22222222-2222-4222-8222-222222222222", title: "Other", compedUntil: null, compedPlan: null, members: [{ userId: 50, status: "Accepted" }] });
  const response = await POST(request("POST", { email: "member@example.test", plan: "Pro", until: until() }));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.candidates.length, 2);
  assert.equal(transactions.length, 0);
});

test("email lookup excludes invited memberships but accepts joined members", serial, async () => {
  teams[0].members[0].status = "Invited";
  const body = { email: "member@example.test", plan: "Pro", until: until() };
  assert.equal((await POST(request("POST", body))).status, 404);
  assert.equal(transactions.length, 0);
  teams[0].members[0].status = "Accepted";
  assert.equal((await POST(request("POST", body))).status, 200);
  assert.equal(transactions.length, 1);
});

test("an invitation to another team does not make an accepted member ambiguous", serial, async () => {
  teams.push({ id: "22222222-2222-4222-8222-222222222222", title: "Invited", members: [{ userId: 50, status: "Invited" }] });
  const response = await POST(request("POST", { email: "member@example.test", plan: "Pro", until: until() }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).comp.teamId, TEAM_ID);
});

test("email lookup still matches a team owner without accepted memberships", serial, async () => {
  teams[0].members = [];
  teams[0].googleAccount = { userId: 50 };
  assert.equal((await POST(request("POST", { email: "owner@example.test", plan: "Pro", until: until() }))).status, 200);
});

test("audit reads the current comp in the transaction instead of the stale lookup", serial, async () => {
  const stale = { ...teams[0] };
  const expiry = new Date(until());
  teams[0] = { ...teams[0], title: "Renamed", compedPlan: "BYOK", compedUntil: expiry };
  await setTeamComp(stale, null, OWNER.id);
  assert.equal(transactions[0][1].data.log,
    `Team comp changed for team ${TEAM_ID} (Renamed): BYOK until ${expiry.toISOString()} -> none`);
});

test("concurrent comp changes audit the value each write actually replaced", serial, async () => {
  const stale = { ...teams[0] };
  const expiry = new Date(until());
  await Promise.all([
    setTeamComp(stale, { plan: "Pro", until: expiry }, OWNER.id),
    setTeamComp(stale, { plan: "BYOK", until: expiry }, OWNER.id),
  ]);
  assert.equal(transactions.length, 2);
  assert.match(transactions[0][1].data.log, /none -> Pro until/);
  assert.equal(transactions[1][1].data.log,
    `Team comp changed for team ${TEAM_ID} (Partner): Pro until ${expiry.toISOString()} -> BYOK until ${expiry.toISOString()}`);
  assert.equal(teams[0].compedPlan, "BYOK");
});

test("audit failure rolls back the comp update", serial, async () => {
  const original = { ...teams[0] };
  failAudit = true;
  await assert.rejects(setTeamComp(original, { plan: "BYOK", until: new Date(until()) }, OWNER.id), /Audit unavailable/);
  assert.deepEqual(teams[0], original);
});

test("all methods reject non-owners and signed-out callers before lookup", serial, async () => {
  for (const user of [null, { id: 8, email: "qa@example.test" }, { id: OWNER.id, email: "impostor@example.test" }]) {
    context = user ? { user } : null;
    assert.equal((await GET(new NextRequest(`https://app.hypertask.ai/api/admin/team-comp?teamId=${TEAM_ID}`))).status, 403);
    assert.equal((await POST(request("POST", { teamId: TEAM_ID, plan: "Pro", until: until() }))).status, 403);
    assert.equal((await DELETE(request("DELETE", { teamId: TEAM_ID }))).status, 403);
  }
  assert.equal(transactions.length, 0);
});

test("owner reads current plan and comp state and searches names case-insensitively", serial, async () => {
  teams[0] = { ...teams[0], compedPlan: "BYOK", compedUntil: new Date(until()) };
  const response = await GET(new NextRequest(`https://app.hypertask.ai/api/admin/team-comp?teamId=${TEAM_ID}`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json();
  assert.equal(body.comp.currentPlan, "BYOK");
  assert.equal(body.comp.compedUntil, teams[0].compedUntil.toISOString());
  const matches = await GET(new NextRequest("https://app.hypertask.ai/api/admin/team-comp?query=PART"));
  assert.equal(matches.status, 200);
  assert.equal((await matches.json()).teams[0].teamId, TEAM_ID);
  const empty = await GET(new NextRequest("https://app.hypertask.ai/api/admin/team-comp?query=absent"));
  assert.deepEqual((await empty.json()).teams, []);
});


test("owner can set Pro and mutation changes only comp fields, not Stripe", serial, async () => {
  const expiry = until();
  const response = await POST(request("POST", { teamId: TEAM_ID, plan: "Pro", until: expiry }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).comp.currentPlan, "Pro");
  assert.deepEqual(transactions[0][0].data, { compedPlan: "Pro", compedUntil: new Date(expiry) });
  assert.equal(transactions[0].length, 2);
});

test("expiry is required and must be an ISO future date", serial, async () => {
  for (const expiry of [undefined, null, "", "not-a-date", 4102444800000]) {
    assert.equal((await POST(request("POST", { teamId: TEAM_ID, plan: "Pro", until: expiry }))).status, 400);
  }
  assert.equal(transactions.length, 0);
});

test("mutations reject foreign or missing origin", serial, async () => {
  for (const method of [POST, DELETE]) {
    const req = request(method === POST ? "POST" : "DELETE", { teamId: TEAM_ID, plan: "Pro", until: until() });
    req.headers.set("origin", "https://evil.example");
    assert.equal((await method(req)).status, 403);
    req.headers.delete("origin");
    assert.equal((await method(req)).status, 403);
  }
  assert.equal(transactions.length, 0);
});

test("unknown teams and invalid lookups do not mutate data", serial, async () => {
  assert.equal((await GET(new NextRequest("https://app.hypertask.ai/api/admin/team-comp?query=x"))).status, 400);
  assert.equal((await GET(new NextRequest("https://app.hypertask.ai/api/admin/team-comp?teamId=invalid"))).status, 400);
  assert.equal((await GET(new NextRequest("https://app.hypertask.ai/api/admin/team-comp?teamId=99999999-9999-4999-8999-999999999999"))).status, 404);
  assert.equal(transactions.length, 0);
});
