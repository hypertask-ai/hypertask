import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { hasValidCronAuthorization } from "@/lib/cronAuthorization";
import type { AiRequestUser } from "@/app/api/ai/_lib/requestUser";
import { verifyHeartbeatExecutionReservation } from "@/app/api/ai/_lib/heartbeatExecution";

/**
 * Lets the native-agent heartbeat cron drive `ai/chat/stream` on behalf of an
 * agent's owner, without a human cookie or OAuth token in hand. Gated on
 * CRON_SECRET (never exposed to any client) plus a specific agent id header,
 * so this is only reachable from the cron route's own server-to-server call,
 * never from a public request -- getAiRequestUser is tried first and this is
 * purely an additive fallback when that returns null.
 *
 * CRON_SECRET alone is not enough to pick an arbitrary user: the header must
 * also carry the exact `heartbeatAt` timestamp the heartbeat's own optimistic
 * claim just wrote to that agent. That value is minted fresh (millisecond
 * precision) inside a single cron invocation and immediately persisted to the
 * row it authorizes against, so anyone forging it needs live DB visibility,
 * not just the static secret -- a CRON_SECRET leak alone no longer upgrades
 * to standing impersonation of any native-agent owner.
 */
export async function getCronServiceRequestUser(
  request: NextRequest
): Promise<AiRequestUser | null> {
  if (
    !hasValidCronAuthorization(
      request.headers.get("Authorization"),
      process.env.CRON_SECRET
    )
  ) {
    return null;
  }
  const agentId = request.headers.get("x-hypertask-heartbeat-agent-id");
  const claimedAtHeader = request.headers.get(
    "x-hypertask-heartbeat-claimed-at"
  );
  const executionId = request.headers.get("x-hypertask-heartbeat-execution-id");
  if (!agentId || !claimedAtHeader || !executionId) return null;
  const claimedAt = new Date(claimedAtHeader);
  if (Number.isNaN(claimedAt.getTime())) return null;

  // The global cron secret is transport authentication only. The durable,
  // one-time reservation binds this request to one agent, owner, session and
  // pair of message ids before the public chat route can act as that owner.
  const execution = await verifyHeartbeatExecutionReservation({
    executionId,
    agentId,
    claimedAt: claimedAt.toISOString(),
  });
  if (!execution) return null;

  const owner = await prisma.agent.findFirst({
    where: {
      id: agentId,
      userId: execution.userId,
      runtimeType: "NATIVE",
      revokedAt: null,
      heartbeatAt: claimedAt,
    },
    select: {
      user: { select: { id: true, email: true, displayName: true } },
    },
  });
  if (!owner) return null;
  return {
    id: owner.user.id,
    email: owner.user.email,
    displayName: owner.user.displayName,
  };
}
