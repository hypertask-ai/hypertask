import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--apply")) {
  throw new Error("Usage: node --env-file=<env> scripts/refresh-stripe-subscriptions.mjs [--apply]");
}
const apply = args.includes("--apply");
const load = createJiti(import.meta.url, {
  alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
});
const { default: prisma } = await load.import("../src/lib/prisma.ts");
const { getRedis } = await load.import("../src/lib/redis.ts");
const { withTeamSeatBillingLock } = await load.import("../src/lib/seatBillingLock.ts");
const { refreshStripeSubscriptionSnapshotWithLockHeld } = await load.import("../src/lib/stripeSubscriptionSnapshot.ts");

let redis;
let cursor;
let refreshed = 0;
let failed = 0;
try {
  while (true) {
    const plans = await prisma.subscriptionPlan.findMany({
      where: { subscriptionStatus: { in: ["active", "trialing", "past_due", "Paid"] } },
      select: { id: true, teamId: true, subscriptionId: true, team: { select: { activeSubscriptionPlanId: true } } },
      orderBy: { id: "asc" }, take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!plans.length) break;
    for (const plan of plans) {
      if (plan.team.activeSubscriptionPlanId !== plan.subscriptionId) continue;
      try {
        redis ??= await getRedis();
        const result = await withTeamSeatBillingLock(plan.teamId, (assertHeld) =>
          refreshStripeSubscriptionSnapshotWithLockHeld(plan.teamId, plan.subscriptionId, assertHeld, apply, true), redis);
        refreshed++;
        console.log(`${apply ? "refreshed" : "would refresh"}\t${plan.teamId}\t${plan.subscriptionId}\t${result.previousQuantity ?? "unknown"} -> ${result.quantity}`);
      } catch (error) {
        failed++;
        console.error(`failed\t${plan.teamId}\t${plan.subscriptionId}\t${error.message}`);
      }
    }
    cursor = plans.at(-1).id;
  }
  console.log(`${apply ? "apply" : "dry-run"}: ${refreshed} subscriptions, ${failed} failures`);
  if (failed) process.exitCode = 1;
} finally {
  redis?.disconnect();
  await prisma.$disconnect();
}
