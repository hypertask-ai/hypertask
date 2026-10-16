import type { AnalyticsOutbox } from "@prisma/client";
import prisma from "@/lib/prisma";
import { HTPR_7272_PAYMENT_LOGIN_AGENT_EVENTS_FLAG, isFeatureEnabled } from "@/lib/flags";
import { isActivationEligible } from "./activationAnalytics";
import { postHogClient } from "./signupAnalytics";

const RETRY_DELAYS_MS = [60000, 300000, 1800000, 7200000, 43200000];
const LEASE_MS = 300000;

type DeliveryResult = "delivered" | "failed" | "skipped";

export async function isAnalyticsOutboxEnabled(userId: number): Promise<boolean> {
  return await isActivationEligible(userId) && await isFeatureEnabled(HTPR_7272_PAYMENT_LOGIN_AGENT_EVENTS_FLAG, userId);
}

export async function deliverAnalyticsOutbox(row: AnalyticsOutbox): Promise<DeliveryResult> {
  let lease: Date | undefined;
  try {
    const client = postHogClient();
    if (!client) return "skipped";
    if (!(await isAnalyticsOutboxEnabled(row.userId))) {
      await prisma.analyticsOutbox.updateMany({
        where: { id: row.id, deliveredAt: null, nextAttemptAt: { lte: new Date() }, attempts: { lt: 10 } },
        data: { nextAttemptAt: new Date(Date.now() + 3600000) },
      });
      return "skipped";
    }
    const now = new Date();
    const leasedUntil = new Date(now.getTime() + LEASE_MS);
    const claimed = await prisma.analyticsOutbox.updateMany({
      where: { id: row.id, deliveredAt: null, nextAttemptAt: { lte: now }, attempts: { lt: 10 } },
      data: { nextAttemptAt: leasedUntil },
    });
    if (!claimed.count) return "skipped";
    lease = leasedUntil;
    await client.captureImmediate({
      distinctId: String(row.userId), event: row.event, uuid: row.uuid,
      properties: row.properties as Record<string, unknown>, timestamp: row.occurredAt,
    });
    const delivered = await prisma.analyticsOutbox.updateMany({
      where: { id: row.id, deliveredAt: null, nextAttemptAt: lease },
      data: { deliveredAt: new Date(), lastError: null },
    });
    return delivered.count ? "delivered" : "skipped";
  } catch {
    if (lease) {
      try {
        await prisma.analyticsOutbox.updateMany({
          where: { id: row.id, deliveredAt: null, nextAttemptAt: lease },
          data: {
            attempts: { increment: 1 },
            nextAttemptAt: new Date(Date.now() + RETRY_DELAYS_MS[Math.min(row.attempts, RETRY_DELAYS_MS.length - 1)]),
            lastError: "PostHog delivery failed",
          },
        });
      } catch {}
    }
    return "failed";
  }
}

export async function retryAnalyticsOutbox() {
  if (!postHogClient()) return { delivered: 0, failed: 0, skipped: 0 };
  const rows = await prisma.analyticsOutbox.findMany({
    where: { deliveredAt: null, nextAttemptAt: { lte: new Date() }, attempts: { lt: 10 } },
    orderBy: { nextAttemptAt: "asc" }, take: 100,
  });
  const results = await Promise.all(rows.map(deliverAnalyticsOutbox));
  return {
    delivered: results.filter((result) => result === "delivered").length,
    failed: results.filter((result) => result === "failed").length,
    skipped: results.filter((result) => result === "skipped").length,
  };
}
