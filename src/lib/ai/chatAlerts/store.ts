import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  AI_CHAT_ALERT_MAX_ATTEMPTS,
  AI_CHAT_ALERT_RETRY_MS,
  AI_CHAT_ALERT_WINDOW_MS,
  incidentTransition,
  type AlertDelivery,
  type AlertEnvironment,
  type AlertIncident,
  type AlertMetrics,
} from "./policy";

export type AlertSample = { latencyMs: number; statusCode: number };

// Raw, parameterized queries keep this additive migration independent of the
// generated client's version during rolling deployments.
export async function evaluateAlerts(
  db: PrismaClient,
  environment: AlertEnvironment,
  sample?: AlertSample,
) {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-chat-alerts:${environment}`}))::text`;
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`;
    const now = clock.now;
    const cutoff = new Date(now.getTime() - AI_CHAT_ALERT_WINDOW_MS);
    // Expiry can breach a healthy window without a new sample. Check each
    // timestamp group before pruning so a later empty window cannot hide it.
    // Nearest-rank p95 exceeds 20s exactly when more than 5% of samples do.
    await tx.$executeRaw`WITH expiry_windows AS (
      SELECT "happenedAt" + ${AI_CHAT_ALERT_WINDOW_MS} * interval '1 millisecond' AS "expiresAt",
        count(*) OVER remaining AS "requestCount",
        count(*) FILTER (WHERE "statusCode" >= 500) OVER remaining AS "errorCount",
        count(*) FILTER (WHERE "latencyMs" > 20000) OVER remaining AS "slowCount"
      FROM "AiChatAlertSample" WHERE "environment" = ${environment}
        AND EXISTS (SELECT 1 FROM "AiChatAlertIncident" WHERE "environment" = ${environment}
          AND "closedAt" IS NULL AND "healthySince" IS NOT NULL)
        AND EXISTS (SELECT 1 FROM "AiChatAlertSample" WHERE "environment" = ${environment} AND "happenedAt" <= ${cutoff})
      WINDOW remaining AS (ORDER BY "happenedAt" GROUPS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING)
    ) UPDATE "AiChatAlertIncident" i SET "healthySince" = NULL
      WHERE i."environment" = ${environment} AND i."closedAt" IS NULL AND i."healthySince" IS NOT NULL
        AND EXISTS (SELECT 1 FROM expiry_windows w WHERE w."expiresAt" > i."healthySince" AND w."expiresAt" <= ${now}
          AND CASE i."kind" WHEN 'error_rate' THEN w."errorCount" ELSE w."slowCount" END > w."requestCount" * 0.05)`;
    await tx.$executeRaw`DELETE FROM "AiChatAlertSample" WHERE "environment" = ${environment} AND "happenedAt" <= ${cutoff}`;
    if (sample) {
      await tx.$executeRaw`INSERT INTO "AiChatAlertSample" ("environment", "happenedAt", "latencyMs", "statusCode")
        VALUES (${environment}, ${now}, ${sample.latencyMs}, ${sample.statusCode})`;
    }
    const [metrics] = await tx.$queryRaw<AlertMetrics[]>`SELECT count(*)::int AS "requestCount",
      count(*) FILTER (WHERE "statusCode" >= 500)::int AS "errorCount",
      COALESCE(percentile_disc(0.95) WITHIN GROUP (ORDER BY "latencyMs"), 0)::int AS "p95Ms"
      FROM "AiChatAlertSample" WHERE "environment" = ${environment} AND "happenedAt" > ${cutoff}`;
    const incidents = await tx.$queryRaw<AlertIncident[]>`SELECT "id", "kind", "healthySince"
      FROM "AiChatAlertIncident" WHERE "environment" = ${environment} AND "closedAt" IS NULL FOR UPDATE`;
    for (const kind of ["error_rate", "latency"] as const) {
      const incident = incidents.find((entry) => entry.kind === kind);
      const transition = incidentTransition(kind, metrics, incident, now);
      if (transition === "open") {
        const id = randomUUID();
        await tx.$executeRaw`INSERT INTO "AiChatAlertIncident" ("id", "environment", "kind", "openedAt")
          VALUES (${id}, ${environment}, ${kind}, ${now})`;
        await enqueueDelivery(tx, id, "breach", metrics, now);
      } else if (incident && transition === "recover") {
        await tx.$executeRaw`UPDATE "AiChatAlertIncident" SET "closedAt" = ${now} WHERE "id" = ${incident.id}`;
        await enqueueDelivery(tx, incident.id, "recovery", metrics, now);
      } else if (incident && transition === "breaching") {
        await tx.$executeRaw`UPDATE "AiChatAlertIncident" SET "healthySince" = NULL WHERE "id" = ${incident.id}`;
      } else if (incident && transition === "healthy" && !incident.healthySince) {
        await tx.$executeRaw`UPDATE "AiChatAlertIncident" SET "healthySince" = ${now} WHERE "id" = ${incident.id}`;
      }
    }
    // Closed incidents and their delivery rows are diagnostic metadata, not history.
    const retention = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
    await tx.$executeRaw`DELETE FROM "AiChatAlertIncident" WHERE "environment" = ${environment} AND "closedAt" < ${retention}`;
  }, { timeout: 10_000 });
}

async function enqueueDelivery(
  tx: Prisma.TransactionClient,
  incidentId: string,
  phase: "breach" | "recovery",
  metrics: AlertMetrics,
  now: Date,
) {
  await tx.$executeRaw`INSERT INTO "AiChatAlertDelivery"
    ("id", "incidentId", "phase", "requestCount", "errorCount", "p95Ms", "happenedAt", "nextAttemptAt")
    VALUES (${`${incidentId}:${phase}`}, ${incidentId}, ${phase}, ${metrics.requestCount}, ${metrics.errorCount}, ${metrics.p95Ms}, ${now}, ${now})`;
}

export async function claimDelivery(db: PrismaClient, environment: AlertEnvironment) {
  await db.$executeRaw`UPDATE "AiChatAlertDelivery" d SET "status" = 'failed'
    FROM "AiChatAlertIncident" i WHERE i."id" = d."incidentId" AND i."environment" = ${environment}
      AND d."status" = 'pending' AND d."attemptCount" >= ${AI_CHAT_ALERT_MAX_ATTEMPTS}
      AND d."nextAttemptAt" <= clock_timestamp()`;
  // Reserve the attempt before sending. A killed worker consumes an attempt,
  // and a lease-expired worker cannot overwrite a newer worker's result.
  const [delivery] = await db.$queryRaw<AlertDelivery[]>`WITH candidate AS (
    SELECT d."id" FROM "AiChatAlertDelivery" d
    JOIN "AiChatAlertIncident" i ON i."id" = d."incidentId"
    WHERE i."environment" = ${environment} AND d."status" = 'pending'
      AND d."attemptCount" < ${AI_CHAT_ALERT_MAX_ATTEMPTS} AND d."nextAttemptAt" <= clock_timestamp()
      AND NOT EXISTS (SELECT 1 FROM "AiChatAlertDelivery" prior
        WHERE prior."incidentId" = d."incidentId" AND prior."phase" = 'breach'
          AND d."phase" = 'recovery' AND prior."status" = 'pending'
          AND (prior."attemptCount" < ${AI_CHAT_ALERT_MAX_ATTEMPTS} OR prior."nextAttemptAt" > clock_timestamp()))
    ORDER BY d."happenedAt", d."id" FOR UPDATE OF d SKIP LOCKED LIMIT 1
  ) UPDATE "AiChatAlertDelivery" d SET "attemptCount" = d."attemptCount" + 1,
    "nextAttemptAt" = clock_timestamp() + CASE d."attemptCount"
      WHEN 0 THEN interval '1 minute' WHEN 1 THEN interval '2 minutes' ELSE interval '4 minutes' END
    FROM candidate c, "AiChatAlertIncident" i WHERE d."id" = c."id" AND i."id" = d."incidentId"
    RETURNING d.*, i."environment", i."kind"`;
  return delivery;
}

export async function finishDelivery(db: PrismaClient, delivery: AlertDelivery, success: boolean) {
  const exhausted = delivery.attemptCount >= AI_CHAT_ALERT_MAX_ATTEMPTS;
  const status = success ? "delivered" : exhausted ? "failed" : "pending";
  const delay = AI_CHAT_ALERT_RETRY_MS[delivery.attemptCount - 1] ?? 0;
  await db.$executeRaw`UPDATE "AiChatAlertDelivery" SET "status" = ${status},
    "nextAttemptAt" = clock_timestamp() + ${delay} * interval '1 millisecond'
    WHERE "id" = ${delivery.id} AND "attemptCount" = ${delivery.attemptCount} AND "status" = 'pending'`;
}
