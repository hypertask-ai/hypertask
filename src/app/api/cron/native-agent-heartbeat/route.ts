import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { hasValidCronAuthorization } from "@/lib/cronAuthorization";
import { after } from "next/server";
import { sweepAiChatAlerts } from "@/lib/ai/chatAlerts/service";
import { agentInboxVisibilityWhere, getStructuredInboxForAgent } from "@/utils/controllers/notifications/getStructuredInboxForAgent";
import { HTPR_7042_NEON_WORK_AVOIDANCE_FLAG, isFeatureEnabled, withFeatureFlagSnapshot } from "@/lib/flags";
import { broadcastInboxChange } from "@/lib/realtime/server";
import {
  completeHeartbeatExecution,
  decideHeartbeatRecovery,
  failHeartbeatExecution,
  getHeartbeatExecution,
  heartbeatAllowanceNoticeId,
  heartbeatRecoveryAllowsNewClaim,
  heartbeatExecutionIds,
  markHeartbeatExecutionNeedsReconciliation,
  markHeartbeatNotificationDelivered,
  reserveHeartbeatExecution,
  type HeartbeatRecoveryOutcome,
  type HeartbeatExecutionState,
} from "@/app/api/ai/_lib/heartbeatExecution";
import {
  aiAllowancePeriod,
  allowanceTeamStamp,
} from "@/lib/aiAllowancePolicy";
import { deliverAgentMessageNotification } from "./agentMessageDelivery";
import {
  decideDurableReservationRecovery,
  decodeHeartbeatTurnMessage,
  encodeHeartbeatTurnMessage,
  isNotificationInHeartbeatWindow,
  streamStoppedOnSpentAllowance,
} from "@/lib/nativeAgent/heartbeatTurnEnvelope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_AGENTS_PER_RUN = 20;
const RUN_DEADLINE_MS = 240_000;
const AGENT_TIMEOUT_MS = 60_000;
const STALE_RUNNING_EXECUTION_MS = 10 * 60_000;
const SCAN_WATERMARK_SAFETY_LAG_MS = 1_000;
const ALLOWANCE_NOTICE =
  "<p><strong>This agent is paused: the team has used its included AI allowance for this month.</strong></p>" +
  "<p>It picks up where it left off next month, or as soon as the team upgrades or adds its own AI key. Nothing in its inbox is lost.</p>";
const RECONCILIATION_NOTICE =
  "<p><strong>This background run needs review.</strong></p>" +
  "<p>Hypertask could not confirm its final reply, so it did not replay any tools. New inbox items will continue processing.</p>";
const HEARTBEAT_PROMPT =
  "You have new items in your inbox. Check it and act on " +
  "anything that needs a response, per your instructions.";

function heartbeatSelfCallBase(): string {
  const base = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_BASEURL ||
    ""
  )
    .trim()
    .replace(/\/+$/, "");
  if (!base) {
    throw new Error(
      "Missing NEXT_PUBLIC_APP_URL/NEXT_PUBLIC_BASEURL; heartbeat self-call has no target."
    );
  }
  return base;
}

type AgentCandidate = {
  id: string;
  userId: number;
  displayName: string;
  heartbeatAt: Date | null;
};

class HeartbeatClaimLostError extends Error {}

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const getScanWatermark = async () => {
  const rows = await prisma.$queryRaw<Array<{ databaseNow: Date }>>(
    Prisma.sql`SELECT CURRENT_TIMESTAMP AS "databaseNow"`,
  );
  if (!rows[0]?.databaseNow) {
    throw new Error("Database scan watermark is unavailable");
  }
  return new Date(
    rows[0].databaseNow.getTime() - SCAN_WATERMARK_SAFETY_LAG_MS,
  );
};

const findAssistantReply = (assistantMessageId: string) =>
  prisma.chatMessage.findUnique({
    where: { id: assistantMessageId },
    select: { content: true },
  });

const findDurableHeartbeatMessages = (
  userMessageId: string,
  assistantMessageId: string,
) =>
  prisma.chatMessage.findMany({
    where: { id: { in: [userMessageId, assistantMessageId] } },
    select: {
      id: true,
      role: true,
      content: true,
      createdAt: true,
      isDelivered: true,
      sessionId: true,
      session: { select: { userId: true, agentId: true } },
    },
  });

const restoreClaim = (state: HeartbeatExecutionState) =>
  prisma.$transaction(
    async (transaction) => {
      const restored = await transaction.agent.updateMany({
        where: {
          id: state.agentId,
          heartbeatAt: new Date(state.claimedAt),
        },
        data: {
          heartbeatAt: state.previousHeartbeatAt
            ? new Date(state.previousHeartbeatAt)
            : null,
        },
      });
      if (restored.count === 0) return false;
      await transaction.chatMessage.deleteMany({
        where: { id: state.userMessageId, sessionId: state.sessionId },
      });
      return true;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

const deliverCompletedExecution = async (
  state: HeartbeatExecutionState,
  content: string,
) => {
  const delivery = await deliverAgentMessageNotification({
    db: prisma,
    assistantMessageId: state.assistantMessageId,
    userId: state.userId,
    agentId: state.agentId,
    content,
  });
  if (delivery === "busy") return false;
  await markHeartbeatNotificationDelivered(state.executionId);
  if (delivery === "created") {
    void broadcastInboxChange(state.userId, { originUserId: state.userId });
  }
  return true;
};

const deliverAllowanceExhaustedNotice = async (
  agent: AgentCandidate,
  periodKey: string,
  teamId: string | null,
) => {
  const delivery = await deliverAgentMessageNotification({
    db: prisma,
    assistantMessageId: heartbeatAllowanceNoticeId(agent.id, periodKey),
    userId: agent.userId,
    agentId: agent.id,
    content: teamId ? ALLOWANCE_NOTICE + allowanceTeamStamp(teamId) : ALLOWANCE_NOTICE,
  });
  if (delivery === "created") {
    void broadcastInboxChange(agent.userId, { originUserId: agent.userId });
  }
};

const deliverReconciliationNotice = async (state: HeartbeatExecutionState) => {
  const delivery = await deliverAgentMessageNotification({
    db: prisma,
    assistantMessageId: state.executionId,
    userId: state.userId,
    agentId: state.agentId,
    content: RECONCILIATION_NOTICE,
  });
  if (delivery === "busy") return false;
  await markHeartbeatNotificationDelivered(state.executionId);
  if (delivery === "created") {
    void broadcastInboxChange(state.userId, { originUserId: state.userId });
  }
  return true;
};

const recoverPriorExecution = async (
  agent: AgentCandidate,
  failures: string[],
): Promise<HeartbeatRecoveryOutcome> => {
  if (!agent.heartbeatAt) return "clear";
  const ids = heartbeatExecutionIds(agent.id, agent.heartbeatAt);
  let state = await getHeartbeatExecution(ids.executionId);
  if (!state) {
    const messages = await findDurableHeartbeatMessages(
      ids.userMessageId,
      ids.assistantMessageId,
    );
    const belongsToAgent = (message: (typeof messages)[number]) =>
      message.session.userId === agent.userId &&
      message.session.agentId === agent.id;
    const reply = messages.find(
      (message) =>
        message.id === ids.assistantMessageId &&
        message.role === "assistant" &&
        belongsToAgent(message),
    );
    if (reply?.content) {
      try {
        const delivery = await deliverAgentMessageNotification({
          db: prisma,
          assistantMessageId: ids.assistantMessageId,
          userId: agent.userId,
          agentId: agent.id,
          content: reply.content,
        });
        if (delivery === "busy") return "pending";
        if (delivery === "created") {
          void broadcastInboxChange(agent.userId, {
            originUserId: agent.userId,
          });
        }
        return delivery === "created" ? "delivered" : "clear";
      } catch (error) {
        failures.push(`${agent.id}: notification delivery ${errorText(error)}`);
        return "pending";
      }
    }
    const started = messages.find(
      (message) =>
        message.id === ids.userMessageId &&
        message.role === "human" &&
        belongsToAgent(message),
    );
    if (started) {
      const durableTurn = decodeHeartbeatTurnMessage(started.content);
      if (
        !durableTurn ||
        durableTurn.metadata.executionId !== ids.executionId ||
        durableTurn.metadata.agentId !== agent.id ||
        durableTurn.metadata.claimedAt !== agent.heartbeatAt.toISOString() ||
        durableTurn.metadata.scanWatermark !== agent.heartbeatAt.toISOString()
      ) {
        failures.push(`${agent.id}: durable reservation identity mismatch`);
        return "pending";
      }
      const reservationDecision = decideDurableReservationRecovery({
        streamStarted: started.isDelivered,
        stale:
          Date.now() - started.createdAt.getTime() >
          STALE_RUNNING_EXECUTION_MS,
      });
      if (reservationDecision === "wait") return "pending";
      if (reservationDecision === "restore") {
        const restored = await prisma.$transaction(
          async (transaction) => {
            const claim = await transaction.agent.updateMany({
              where: { id: agent.id, heartbeatAt: agent.heartbeatAt },
              data: {
                heartbeatAt: durableTurn.metadata.previousHeartbeatAt
                  ? new Date(durableTurn.metadata.previousHeartbeatAt)
                  : null,
              },
            });
            if (claim.count === 0) return false;
            const removed = await transaction.chatMessage.deleteMany({
              where: {
                id: started.id,
                sessionId: started.sessionId,
                isDelivered: false,
              },
            });
            if (removed.count === 0) {
              throw new Error("Heartbeat reservation started during recovery");
            }
            return true;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        if (!restored) return "pending";
        failures.push(
          `${agent.id}: durable unstarted reservation restored for retry`,
        );
        return "restored";
      }
      try {
        const delivery = await deliverAgentMessageNotification({
          db: prisma,
          assistantMessageId: ids.executionId,
          userId: agent.userId,
          agentId: agent.id,
          content: RECONCILIATION_NOTICE,
        });
        if (delivery === "busy") return "pending";
        if (delivery === "created") {
          void broadcastInboxChange(agent.userId, {
            originUserId: agent.userId,
          });
        }
        failures.push(
          `${agent.id}: durable execution record missing; turn not replayed`,
        );
        return "reconciled";
      } catch (error) {
        failures.push(`${agent.id}: reconciliation notice ${errorText(error)}`);
        return "pending";
      }
    }
    return "clear";
  }
  if (
    state.agentId !== agent.id ||
    state.userId !== agent.userId ||
    state.claimedAt !== agent.heartbeatAt.toISOString()
  ) {
    failures.push(`${agent.id}: heartbeat execution identity mismatch`);
    return "pending";
  }

  const reply = await findAssistantReply(state.assistantMessageId);
  const stale =
    Date.now() - Date.parse(state.updatedAt) > STALE_RUNNING_EXECUTION_MS;
  const decision = decideHeartbeatRecovery({
    status: state.status,
    mutationStarted: state.mutationStarted,
    notificationDelivered: state.notificationDelivered,
    replyExists: Boolean(reply?.content),
    stale,
  });

  if (decision === "advance") {
    return state.status === "needs_reconciliation" ? "reconciled" : "clear";
  }

  if (decision === "deliver" && reply?.content) {
    await completeHeartbeatExecution(state.executionId);
    state = (await getHeartbeatExecution(state.executionId)) ?? state;
    try {
      return (await deliverCompletedExecution(state, reply.content))
        ? "delivered"
        : "pending";
    } catch (error) {
      failures.push(`${agent.id}: notification delivery ${errorText(error)}`);
      return "pending";
    }
  }

  if (decision === "restore") {
    if (state.status === "reserved") {
      await failHeartbeatExecution(state.executionId, "stream never started");
    } else if (state.status === "running") {
      await failHeartbeatExecution(
        state.executionId,
        "stale stream ended before any mutation",
      );
    }
    await restoreClaim(state);
    failures.push(`${agent.id}: pre-mutation execution restored for retry`);
    return "restored";
  }

  if (decision === "wait") return "pending";

  const failure =
    state.status === "running" && stale
      ? "stream ended without a durable terminal result"
      : state.status === "completed"
        ? "completed execution has no assistant reply"
        : `${state.status} execution is unsafe to replay`;
  await markHeartbeatExecutionNeedsReconciliation(state.executionId, failure);
  state = (await getHeartbeatExecution(state.executionId)) ?? state;
  failures.push(`${agent.id}: ${failure}; tools not replayed`);
  try {
    return (await deliverReconciliationNotice(state))
      ? "reconciled"
      : "pending";
  } catch (error) {
    failures.push(`${agent.id}: reconciliation notice ${errorText(error)}`);
    return "pending";
  }
};

export async function GET(request: NextRequest) {
  return withFeatureFlagSnapshot(() => runHeartbeat(request));
}

async function runHeartbeat(request: NextRequest) {
  if (
    !hasValidCronAuthorization(
      request.headers.get("authorization"),
      process.env.CRON_SECRET,
    )
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  after(sweepAiChatAlerts);

  let callbackBase: string;
  try {
    callbackBase = heartbeatSelfCallBase();
  } catch (error) {
    console.error("native agent heartbeat: missing callback base", error);
    return NextResponse.json(
      { error: "missing callback base url" },
      { status: 500 },
    );
  }

  const avoidRepeatedWork = await isFeatureEnabled(HTPR_7042_NEON_WORK_AVOIDANCE_FLAG, 0).catch(() => false);
  const agents: AgentCandidate[] = await prisma.agent.findMany({
    where: { runtimeType: "NATIVE", revokedAt: null },
    select: { id: true, userId: true, displayName: true, heartbeatAt: true },
    orderBy: [{ heartbeatAt: { sort: "asc", nulls: "first" } }],
    take: MAX_AGENTS_PER_RUN,
  });

  let woken = 0;
  const failures: string[] = [];
  const runStart = Date.now();

  for (const agent of agents) {
    if (Date.now() - runStart > RUN_DEADLINE_MS) {
      failures.push(`${agent.id}: skipped, run deadline reached`);
      continue;
    }

    try {
      const recovery = await recoverPriorExecution(agent, failures);
      if (recovery === "delivered") {
        woken += 1;
        continue;
      }
      if (!heartbeatRecoveryAllowsNewClaim(recovery)) continue;
    } catch (error) {
      failures.push(`${agent.id}: recovery ${errorText(error)}`);
      continue;
    }

    try {
      const claimedAt = await getScanWatermark();
      if (agent.heartbeatAt && claimedAt <= agent.heartbeatAt) continue;
      const previousHeartbeatAt = agent.heartbeatAt?.toISOString() ?? null;
      const probe = avoidRepeatedWork
        ? await prisma.agent.findFirst({
            where: { id: agent.id, userId: agent.userId, revokedAt: null },
            select: {
              notificationsToAgent: {
                where: agentInboxVisibilityWhere(agent.userId, { after: agent.heartbeatAt, through: claimedAt }),
                select: { id: true },
                take: 1,
              },
            },
          }).catch(() => undefined)
        : undefined;
      const inbox = probe === null
        ? { ok: false as const, kind: "not_found" as const }
        : probe?.notificationsToAgent.length === 0
          ? { ok: true as const, notifications: [] }
          : await getStructuredInboxForAgent({
              userId: agent.userId,
              agentId: agent.id,
              window: {
                after: agent.heartbeatAt,
                through: claimedAt,
              },
            });
      if (!inbox.ok) {
        failures.push(`${agent.id}: inbox lookup ${inbox.kind}`);
        continue;
      }
      const hasNew = inbox.notifications.some(
        (notification) =>
          isNotificationInHeartbeatWindow(
            notification.createdAt,
            previousHeartbeatAt,
            claimedAt.toISOString(),
          ),
      );
      if (!hasNew) {
        await prisma.agent.updateMany({
          where: { id: agent.id, heartbeatAt: agent.heartbeatAt },
          data: { heartbeatAt: claimedAt },
        });
        continue;
      }

      const session = await prisma.chatSession.upsert({
        where: { userId_agentId: { userId: agent.userId, agentId: agent.id, agentSessionKey: "default" } },
        update: {},
        create: {
          userId: agent.userId,
          agentId: agent.id,
          title: agent.displayName,
        },
        select: { id: true },
      });
      const ids = heartbeatExecutionIds(agent.id, claimedAt);
      const execution = await reserveHeartbeatExecution({
        ...ids,
        agentId: agent.id,
        userId: agent.userId,
        sessionId: session.id,
        claimedAt: claimedAt.toISOString(),
        previousHeartbeatAt,
      });
      const heartbeatMessage = encodeHeartbeatTurnMessage(HEARTBEAT_PROMPT, {
        version: 1,
        executionId: execution.executionId,
        agentId: agent.id,
        claimedAt: claimedAt.toISOString(),
        scanWatermark: claimedAt.toISOString(),
        previousHeartbeatAt,
      });

      try {
        await prisma.$transaction(
          async (transaction) => {
            await transaction.chatMessage.create({
              data: {
                id: execution.userMessageId,
                sessionId: session.id,
                content: heartbeatMessage,
                role: "human",
                isDelivered: false,
              },
            });
            const claim = await transaction.agent.updateMany({
              where: { id: agent.id, heartbeatAt: agent.heartbeatAt },
              data: { heartbeatAt: claimedAt },
            });
            if (claim.count === 0) throw new HeartbeatClaimLostError();
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        await failHeartbeatExecution(
          execution.executionId,
          error instanceof HeartbeatClaimLostError
            ? "heartbeat claim was won by another invocation"
            : `durable claim failed: ${errorText(error)}`,
        ).catch(() => undefined);
        if (error instanceof HeartbeatClaimLostError) continue;
        throw error;
      }

      const streamController = new AbortController();
      const streamTimeout = setTimeout(
        () => streamController.abort(),
        AGENT_TIMEOUT_MS,
      );
      let streamResponse: Response;
      let streamBody = "";
      try {
        streamResponse = await fetch(`${callbackBase}/api/ai/chat/stream`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.CRON_SECRET}`,
            "x-hypertask-heartbeat-agent-id": agent.id,
            "x-hypertask-heartbeat-claimed-at": claimedAt.toISOString(),
            "x-hypertask-heartbeat-execution-id": execution.executionId,
          },
          body: JSON.stringify({
            message: heartbeatMessage,
            session_id: session.id,
            user_message_id: execution.userMessageId,
            assistant_message_id: execution.assistantMessageId,
            stream_id: execution.executionId,
            heartbeat_execution_id: execution.executionId,
          }),
          signal: streamController.signal,
        });
        streamBody = await streamResponse.text();
      } catch (error) {
        if (streamController.signal.aborted) {
          failures.push(
            `${agent.id}: stream timed out; awaiting durable result`,
          );
          continue;
        }
        throw error;
      } finally {
        clearTimeout(streamTimeout);
      }

      const reply = await findAssistantReply(execution.assistantMessageId);
      if (reply?.content) {
        await completeHeartbeatExecution(execution.executionId);
        const latest =
          (await getHeartbeatExecution(execution.executionId)) ?? execution;
        if (await deliverCompletedExecution(latest, reply.content)) {
          woken += 1;
        } else {
          failures.push(
            `${agent.id}: notification delivery already in progress`,
          );
        }
        continue;
      }

      const allowanceStop = streamStoppedOnSpentAllowance(streamBody);
      if (allowanceStop) {
        await deliverAllowanceExhaustedNotice(
          agent,
          allowanceStop.periodKey ?? aiAllowancePeriod(claimedAt).key,
          allowanceStop.teamId,
        ).catch((error) => {
          failures.push(`${agent.id}: allowance notice ${errorText(error)}`);
        });
      }

      const latest = await getHeartbeatExecution(execution.executionId);
      if (
        latest &&
        ((latest.status === "failed" && !latest.mutationStarted) ||
          latest.status === "reserved")
      ) {
        await restoreClaim(latest);
        failures.push(`${agent.id}: safe stream failure restored for retry`);
        continue;
      }
      if (!streamResponse.ok) {
        failures.push(`${agent.id}: stream ${streamResponse.status}`);
      } else if (/event:\s*error/.test(streamBody)) {
        failures.push(`${agent.id}: stream returned an error event`);
      } else {
        failures.push(`${agent.id}: durable reply is still pending`);
      }
    } catch (error) {
      failures.push(`${agent.id}: ${errorText(error)}`);
      console.error(`native agent heartbeat failed for ${agent.id}`, error);
    }
  }

  const allFailed = agents.length > 0 && woken === 0 && failures.length > 0;
  return NextResponse.json(
    { agents: agents.length, woken, failed: failures },
    { status: allFailed ? 500 : 200 },
  );
}
