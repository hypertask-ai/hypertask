import type { AgentRun } from "@prisma/client";
import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import {
  persistAgentRunStoppedWebhook,
  publishAgentWebhookDeliveries,
} from "@/lib/agentWebhooks/outbox";
import { isFeatureEnabled } from "@/lib/flags";
import { validateMcpAuth } from "@/lib/mcp/auth";
import prisma from "@/lib/prisma";
import {
  AGENT_RUN_FEATURE_FLAG,
  AGENT_RUN_STALE_AFTER_MS,
  NONTERMINAL_AGENT_RUN_STATUSES,
  serializeAgentRun,
} from "./model";

export type AgentRunPrincipal = {
  userId: number;
  agentId: string | null;
  displayName: string;
  source: "agent" | "browser";
};

export async function authenticateAgentRunRequest(
  request: NextRequest,
): Promise<AgentRunPrincipal | null> {
  if (request.headers.has("Authorization")) {
    const context = await validateMcpAuth(request);
    if (!context?.agentId) return null;
    return {
      userId: context.user.id,
      agentId: context.agentId,
      displayName: context.user.displayName?.trim() || "Hypertask agent",
      source: "agent",
    };
  }

  const session = await getSessionUser(request.headers);
  if (!session) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, displayName: true },
  });
  if (!user) return null;
  return {
    userId: user.id,
    agentId: null,
    displayName: user.displayName?.trim() || "Hypertask user",
    source: "browser",
  };
}

export function browserMutationIsSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  return origin === request.nextUrl.origin;
}

function accessibleRunWhere(principal: AgentRunPrincipal, id: string) {
  return {
    id,
    ...(principal.agentId
      ? { agentId: principal.agentId }
      : { agent: { userId: principal.userId } }),
  };
}

export async function agentRunsEnabledFor(
  principal: AgentRunPrincipal,
): Promise<boolean> {
  return isFeatureEnabled(AGENT_RUN_FEATURE_FLAG, principal.userId);
}

export async function readAgentRun(
  principal: AgentRunPrincipal,
  id: string,
  now = new Date(),
) {
  return prisma.$transaction(async (tx) => {
    let run = await tx.agentRun.findFirst({
      where: accessibleRunWhere(principal, id),
    });
    if (!run) return null;

    const staleBefore = new Date(now.getTime() - AGENT_RUN_STALE_AFTER_MS);
    if (run.status === "ACTIVE" && run.lastActivityAt <= staleBefore) {
      const stale = await tx.agentRun.updateMany({
        where: {
          id: run.id,
          status: "ACTIVE",
          lastActivityAt: run.lastActivityAt,
        },
        data: { status: "STALE" },
      });
      if (stale.count === 1) {
        run = { ...run, status: "STALE" };
      } else {
        run = await tx.agentRun.findFirst({
          where: accessibleRunWhere(principal, id),
        });
        if (!run) return null;
      }
    }
    return serializeAgentRun(run);
  });
}

type RunWithContext = AgentRun & {
  task: {
    id: number;
    projectId: number;
    ticketNumber: string | null;
    title: string;
  } | null;
};

export async function stopAgentRun(
  principal: AgentRunPrincipal,
  id: string,
  now = new Date(),
) {
  const result = await prisma.$transaction(async (tx) => {
    const run = (await tx.agentRun.findFirst({
      where: accessibleRunWhere(principal, id),
      include: {
        task: {
          select: {
            id: true,
            projectId: true,
            ticketNumber: true,
            title: true,
          },
        },
      },
    })) as RunWithContext | null;
    if (!run) return null;
    if (!NONTERMINAL_AGENT_RUN_STATUSES.includes(run.status)) {
      return { run: serializeAgentRun(run), deliveryIds: [] as string[] };
    }

    const stoppedById = principal.source === "browser" ? principal.userId : null;
    const stopped = await tx.agentRun.updateMany({
      where: {
        id: run.id,
        status: { in: NONTERMINAL_AGENT_RUN_STATUSES },
      },
      data: {
        status: "STOPPED",
        stoppedById,
        lastActivityAt: now,
      },
    });
    if (stopped.count === 0) {
      const current = await tx.agentRun.findFirst({
        where: accessibleRunWhere(principal, id),
      });
      return current
        ? { run: serializeAgentRun(current), deliveryIds: [] as string[] }
        : null;
    }

    const stoppedRun = {
      ...run,
      status: "STOPPED" as const,
      stoppedById,
      lastActivityAt: now,
    };
    const deliveryId = await persistAgentRunStoppedWebhook(tx, {
      agentId: run.agentId,
      projectId: run.task?.projectId ?? null,
      taskId: run.taskId,
      ticketNumber: run.task?.ticketNumber ?? null,
      taskTitle: run.task?.title ?? null,
      actor: {
        userId: principal.userId,
        agentId: principal.agentId,
        displayName: principal.displayName,
      },
      runId: run.id,
      run: serializeAgentRun(stoppedRun),
    });
    return {
      run: serializeAgentRun(stoppedRun),
      deliveryIds: deliveryId ? [deliveryId] : [],
    };
  });

  if (result) await publishAgentWebhookDeliveries(result.deliveryIds);
  return result?.run ?? null;
}
