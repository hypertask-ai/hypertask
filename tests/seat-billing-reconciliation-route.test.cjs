const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("daily reconciliation is authenticated, paginated, and production-scheduled", () => {
  const route = read("src/app/api/cron/reconcile-seat-billing/route.ts");
  const vercel = JSON.parse(read("vercel.json"));

  assert.match(route, /hasValidCronAuthorization/);
  assert.match(route, /reconcileSeatBillingForTeam/);
  assert.match(route, /cursor: \{ id: cursor \}/);
  assert.match(
    route,
    /subscriptionStatus: \{ in: \["Paid", "active", "trialing"\] \}/,
  );
  assert.deepEqual(
    vercel.crons.find(
      (cron) => cron.path === "/api/cron/reconcile-seat-billing",
    ),
    { path: "/api/cron/reconcile-seat-billing", schedule: "17 3 * * *" },
  );
});

test("daily reconciliation includes pending subscription cancellations", async () => {
  const pendingKey = "hypertaskPendingPreviousSubscriptionCancellationId";
  const routeJavascript = ts.transpileModule(
    read("src/app/api/cron/reconcile-seat-billing/route.ts"),
    {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  let findManyArgs;
  const reconciled = [];
  const teams = [
    {
      id: "team_pending",
      subscriptionPlan: [
        {
          subscriptionStatus: "Expired",
          subscriptionObject: { [pendingKey]: "sub_old" },
        },
      ],
    },
    {
      id: "team_inactive",
      subscriptionPlan: [
        { subscriptionStatus: "Expired", subscriptionObject: {} },
      ],
    },
  ];
  const stubs = {
    "next/server": {
      NextResponse: {
        json: (body, options) => ({ body, status: options.status }),
      },
    },
    "@/lib/constants/constants": {
      isSubscriptionActive: (status) =>
        ["Paid", "active", "trialing"].includes(status),
    },
    "@/lib/cronAuthorization": { hasValidCronAuthorization: () => true },
    "@/lib/pendingStripeSubscriptionCancellation": {
      PENDING_STRIPE_CANCELLATION_KEY: pendingKey,
      pendingStripeCancellationId: (subscriptionObject) =>
        subscriptionObject?.[pendingKey] ?? null,
    },
    "@/lib/prisma": {
      __esModule: true,
      default: {
        team: {
          findMany: async (args) => {
            findManyArgs = args;
            return teams;
          },
        },
      },
    },
    "@/lib/syncSeatBilling": {
      reconcileSeatBillingForTeam: async (teamId) => {
        reconciled.push(teamId);
        return "OK";
      },
    },
  };
  const mod = { exports: {} };
  new Function("module", "exports", "require", routeJavascript)(
    mod,
    mod.exports,
    (request) => stubs[request] ?? require(request),
  );

  const response = await mod.exports.GET({
    headers: { get: () => "Bearer valid" },
  });

  assert.deepEqual(reconciled, ["team_pending"]);
  assert.deepEqual(response.body, {
    scanned: 2,
    reconciled: 0,
    unchanged: 1,
    skipped: 1,
    failed: 0,
  });
  assert.deepEqual(
    findManyArgs.where.OR[1].subscriptionPlan.some.subscriptionObject,
    { path: [pendingKey], string_starts_with: "sub_" },
  );
});

test("the membership migration preserves links, deduplicates, then enforces uniqueness", () => {
  const schema = read("src/prisma/schema.prisma");
  const migration = read(
    "src/prisma/migrations/20260811213000_unique_team_membership/migration.sql",
  );

  assert.match(
    schema,
    /model Member_Team[\s\S]*@@unique\(\[userId, teamId\]\)/,
  );
  assert.match(migration, /UPDATE "Notification"/);
  assert.match(migration, /DELETE FROM "Member_Team"/);
  assert.match(migration, /BOOL_OR\(status = 'Accepted'\)/);
  assert.match(migration, /membership\.status = 'Accepted'/);
  assert.match(migration, /SET "totalSeats" = seat_count\.actual_seats/);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "Member_Team_userId_teamId_key"/,
  );
  assert.ok(
    migration.indexOf('UPDATE "Notification"') <
      migration.indexOf('DELETE FROM "Member_Team"'),
  );
  assert.ok(
    migration.indexOf('DELETE FROM "Member_Team"') <
      migration.indexOf("CREATE UNIQUE INDEX"),
  );
});

test("every live team-join path uses conflict-safe membership and serialized billing", () => {
  for (const file of [
    "src/utils/controllers/members/invite.ts",
    "src/utils/controllers/members/share.ts",
    "src/utils/controllers/users/autoJoinByEmailDomain.ts",
  ]) {
    const source = read(file);
    assert.match(source, /ensureTeamMembership/);
    assert.match(source, /mutateAndSyncSeatBilling/);
    assert.match(source, /withTeamSeatBillingLock/);
    assert.match(source, /async \(assertHeld\)/);
    assert.match(source, /assertHeld\(\)/);
    assert.match(source, /acceptedTeamMember\?\.status !== "Accepted"/);
  }
  const leave = read("src/utils/controllers/teams/leave.ts");
  assert.match(leave, /mutateAndSyncSeatBilling/);
  assert.ok(
    leave.indexOf("mutateAndSyncSeatBilling") <
      leave.indexOf("tx.member.deleteMany"),
  );
});

test("billing derives accepted seats from unique memberships, not the cached counter", () => {
  const source = read("src/lib/resolveSeatQuantity.ts");
  assert.match(source, /members: \{[\s\S]*where: \{ status: "Accepted" \}/);
  assert.match(source, /const acceptedUserIds = new Set/);
  assert.match(
    source,
    /totalSeats: acceptedUserIds\.size \|\| team\.totalSeats/,
  );
});
