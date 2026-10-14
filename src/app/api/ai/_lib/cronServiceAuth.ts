import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { hasValidCronAuthorization } from "@/lib/cronAuthorization";
import type { AiRequestUser } from "@/app/api/ai/_lib/requestUser";
import { verifyHeartbeatExecutionReservation } from "@/app/api/ai/_lib/heartbeatExecution";

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
