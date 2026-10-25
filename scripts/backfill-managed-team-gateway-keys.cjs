#!/usr/bin/env node

const path = require("node:path");
const dotenv = require("dotenv");
const jitiFactory = require("jiti");

async function backfillManagedTeamGatewayKeys({ apply = false } = {}) {
  const root = path.resolve(__dirname, "..");
  dotenv.config({ path: path.join(root, ".env.local") });
  const jiti = jitiFactory(__filename, {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  });
  const prisma = jiti(path.join(root, "src/lib/prisma.ts")).default;
  const { withTeamSeatBillingLock } = jiti(path.join(root, "src/lib/seatBillingLock.ts"));
  const { ensureManagedTeamGatewayKeyWithTeamLockHeld } = jiti(
    path.join(root, "src/lib/provisionManagedTeamGatewayKey.ts"),
  );
  const counts = { created: 0, missing: 0, existing: 0, ineligible: 0 };
  let cursor;
  try {
    for (;;) {
      const teams = await prisma.team.findMany({
        where: { subscriptionPlan: { some: {} } },
        select: { id: true },
        orderBy: { id: "asc" },
        take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (teams.length === 0) break;
      for (const team of teams) {
        const status = await withTeamSeatBillingLock(team.id, (assertHeld) =>
          ensureManagedTeamGatewayKeyWithTeamLockHeld(team.id, assertHeld, { dryRun: !apply }),
        );
        counts[status] += 1;
        console.log(`${team.id}\t${status}`);
      }
      cursor = teams[teams.length - 1].id;
    }
    console.log(`${apply ? "Applied" : "Dry run"}: ${JSON.stringify(counts)}`);
    return counts;
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = { backfillManagedTeamGatewayKeys };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--apply")) {
    console.error("Usage: node scripts/backfill-managed-team-gateway-keys.cjs [--apply]");
    process.exitCode = 1;
  } else {
    backfillManagedTeamGatewayKeys({ apply: args[0] === "--apply" }).then(
      () => process.exit(0),
      (error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      },
    );
  }
}
