import crypto from "crypto";
import {
  AgentRunActivityType,
  Status,
  type AgentRun,
  type AgentRunActivity,
} from "@prisma/client";
import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import {
  persistAgentRunStoppedWebhook,
  persistAgentWebhookEvent,
  publishAgentWebhookDeliveries,
} from "@/lib/agentWebhooks/outbox";
import { isFeatureEnabled } from "@/lib/flags";
import { validateMcpAuth } from "@/lib/mcp/auth";
import prisma from "@/lib/prisma";
import {
  AGENT_CHAT_STOPPED_MESSAGE,
  AGENT_CHAT_TIMEOUT_MESSAGE,
  AGENT_RUN_ACTIVITY_FEATURE_FLAG,
  AGENT_RUN_FEATURE_FLAG,
  AGENT_SDK_FEATURE_FLAG,
  AGENT_RUN_STALE_AFTER_MS,
  AgentRunActivityConflictError,
  AgentRunActivityInputError,
  AgentRunNotActiveError,
  AgentRunSelectionConflictError,
  NONTERMINAL_AGENT_RUN_STATUSES,
  agentRunActivityMatchesInput,
  serializeAgentRun,
  serializeAgentRunActivity,
  storedAgentRunActivityOptions,
  type AgentRunActivityInput,
  type AgentRunContext,
} from "./model";
import {
  persistAgentRunActivity,
  persistAgentRunSelection,
  type AgentRunActivityPersistenceInput,
  type AgentRunSelectionPersistenceInput,
} from "./persistence";
import { toStoredHtml } from "@/utils/helperFunctions/toStoredHtml";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import {
  AGENT_CHAT_EVENT,
  broadcast,
  broadcastTaskComment,
  userChannel,
} from "@/lib/realtime/server";

export type AgentRunPrincipal = {
  userId: number;
  agentId: string | null;
  displayName: string;
  source: "agent" | "browser";
  sdk?: "typescript";
};

const AGENT_RUN_ACTIVITY_LIST_LIMIT = 500;

export async function authenticateAgentRunRequest(
  request: NextRequest,
): Promise<AgentRunPrincipal | null> {
  const sdk =
    request.headers.get("X-Hypertask-Agent-SDK") === "typescript"
      ? ("typescript" as const)
      : undefined;
  if (request.headers.has("Authorization")) {
    const context = await validateMcpAuth(request);
    if (!context?.agentId) return null;
    return {
      userId: context.user.id,
      agentId: context.agentId,
      displayName: context.user.displayName?.trim() || "Hypertask agent",
      source: "agent",
      ...(sdk ? { sdk } : {}),
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
    ...(sdk ? { sdk } : {}),
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
  if (!(await isFeatureEnabled(AGENT_RUN_FEATURE_FLAG, principal.userId))) return false;
  return (
    principal.sdk !== "typescript" ||
    isFeatureEnabled(AGENT_SDK_FEATURE_FLAG, principal.userId)
  );
}

export async function agentRunActivitiesEnabledFor(
  principal: AgentRunPrincipal,
): Promise<boolean> {
  return (
    (await agentRunsEnabledFor(principal)) &&
    (await isFeatureEnabled(AGENT_RUN_ACTIVITY_FEATURE_FLAG, principal.userId))
  );
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

const chatRunSummary = (run: Pick<AgentRun, "id">) => ({ id: run.id });

async function reconcileAgentChatTurn(
  principal: AgentRunPrincipal,
  sessionId: string,
  stop: boolean,
  now: Date,
) {
  if (principal.source !== "browser") return null;
  const result = await prisma.$transaction(async (tx) => {
    const session = await tx.chatSession.findFirst({
      where: { id: sessionId, userId: principal.userId, agentId: { not: null } },
      select: {
        id: true,
        messages: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { id: true, role: true, createdAt: true },
        },
        agentRuns: {
          where: { status: { in: NONTERMINAL_AGENT_RUN_STATUSES } },
          orderBy: [{ lastActivityAt: "desc" }, { id: "desc" }],
          take: 1,
        },
      },
    });
    if (!session) return null;
    const message = session.messages[0];
    if (message?.role !== "human") {
      return stop ? null : { awaiting: false, run: null, changed: false, deliveryId: null };
    }
    const run = session.agentRuns[0]?.lastActivityAt >= message.createdAt
      ? session.agentRuns[0]
      : null;
    const expired = now.getTime() - message.createdAt.getTime() >= AGENT_RUN_STALE_AFTER_MS;
    if (!stop && !expired) {
      return {
        awaiting: true,
        run: run ? chatRunSummary(run) : null,
        changed: false,
        deliveryId: null,
      };
    }
    if (stop && !run) return null;

    const marker = await tx.chatMessage.createMany({
      data: [{
        sessionId,
        content: stop ? AGENT_CHAT_STOPPED_MESSAGE : AGENT_CHAT_TIMEOUT_MESSAGE,
        role: "assistant",
        isDelivered: false,
        replyToMessageId: message.id,
        createdAt: now,
      }],
      skipDuplicates: true,
    });
    if (marker.count === 0) {
      return stop ? null : { awaiting: false, run: null, changed: false, deliveryId: null };
    }

    let deliveryId: string | null = null;
    if (run) {
      const stopped = await tx.agentRun.updateMany({
        where: { id: run.id, status: { in: NONTERMINAL_AGENT_RUN_STATUSES } },
        data: { status: "STOPPED", stoppedById: principal.userId, lastActivityAt: now },
      });
      if (stopped.count === 0) throw new Error("Agent chat run changed while stopping");
      const stoppedRun = {
        ...run,
        status: "STOPPED" as const,
        stoppedById: principal.userId,
        lastActivityAt: now,
      };
      deliveryId = await persistAgentRunStoppedWebhook(tx, {
        agentId: run.agentId,
        projectId: null,
        taskId: null,
        ticketNumber: null,
        taskTitle: null,
        actor: { userId: principal.userId, agentId: null, displayName: principal.displayName },
        runId: run.id,
        run: serializeAgentRun(stoppedRun),
      });
    }
    await tx.chatSession.update({ where: { id: sessionId }, data: { updatedAt: now } });
    return {
      awaiting: false,
      run: run ? chatRunSummary(run) : null,
      changed: true,
      deliveryId,
    };
  });

  if (result?.deliveryId) await publishAgentWebhookDeliveries([result.deliveryId]);
  if (result?.changed) {
    void broadcast(userChannel(principal.userId), AGENT_CHAT_EVENT, { sessionId }).catch(console.warn);
  }
  return result;
}

/** Read the current turn and durably time it out after five minutes. */
export async function readAgentChatTurn(principal: AgentRunPrincipal, sessionId: string, now = new Date()) {
  const result = await reconcileAgentChatTurn(principal, sessionId, false, now);
  return result ? { awaiting: result.awaiting, run: result.awaiting ? result.run : null } : null;
}

/** Stop only the current unanswered turn in a browser-owned chat session. */
export async function stopAgentChatTurn(principal: AgentRunPrincipal, sessionId: string, now = new Date()) {
  const result = await reconcileAgentChatTurn(principal, sessionId, true, now);
  return result?.run ? { run: result.run } : null;
}

type ActivityRunWithContext = AgentRun & {
  agent: {
    user: {
      id: number;
      email: string;
      displayName: string | null;
      photoURL: string | null;
    };
  };
  task: {
    id: number;
    userId: number;
  } | null;
  chatSession: {
    id: string;
    userId: number;
  } | null;
};

function activityRunContext(run: ActivityRunWithContext): AgentRunContext {
  if (run.taskId !== null && run.chatSessionId === null) {
    return { taskId: run.taskId, chatSessionId: null };
  }
  if (run.taskId === null && run.chatSessionId !== null) {
    return { taskId: null, chatSessionId: run.chatSessionId };
  }
  throw new Error("Agent run has invalid context");
}

async function findActivityRun(
  principal: AgentRunPrincipal,
  id: string,
): Promise<ActivityRunWithContext | null> {
  return prisma.agentRun.findFirst({
    where: accessibleRunWhere(principal, id),
    include: {
      agent: {
        select: {
          user: {
            select: { id: true, email: true, displayName: true, photoURL: true },
          },
        },
      },
      task: { select: { id: true, userId: true } },
      chatSession: { select: { id: true, userId: true } },
    },
  }) as Promise<ActivityRunWithContext | null>;
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002",
  );
}

async function findIdempotentActivity(
  runId: string,
  idempotencyKey: string,
): Promise<AgentRunActivity | null> {
  return prisma.agentRunActivity.findUnique({
    where: { runId_idempotencyKey: { runId, idempotencyKey } },
  });
}

async function replayCreatedActivity(
  run: ActivityRunWithContext,
  principal: AgentRunPrincipal,
  activity: AgentRunActivity,
  input: AgentRunActivityInput,
) {
  if (!agentRunActivityMatchesInput(activity, input)) {
    throw new AgentRunActivityConflictError(
      "Idempotency-Key was already used with different activity data",
    );
  }
  // Older activities have no comment link, so they retain duplicate-only replay.
  if (input.type === "RESPONSE" && run.task && activity.responseCommentId) {
    const { createCommentService } = await import(
      "@/utils/controllers/comments/createCommentService",
    );
    await createCommentService({
      text: toStoredHtml(activity.text),
      creatorId: run.agent.user.id,
      taskId: run.task.id,
      ownerId: run.task.userId,
      currentUser: run.agent.user,
      agentId: run.agentId,
      accessUserId: principal.userId,
      agentRunReplayComment: {
        id: activity.responseCommentId,
        activityId: activity.id,
        agentWebhookDeliveryIds: activity.commentAgentWebhookDeliveryIds,
        boardWebhookDeliveryIds: activity.commentBoardWebhookDeliveryIds,
        notificationsCompletedAt: activity.commentNotificationsCompletedAt,
      },
    });
  }
  return { activity: serializeAgentRunActivity(activity), duplicate: true };
}

function broadcastActivityChange(
  run: ActivityRunWithContext,
  originUserId: number,
) {
  if (run.taskId !== null) {
    void broadcastTaskComment(run.taskId, { originUserId }).catch((error) =>
      console.warn("[agent-run] task activity broadcast failed", error),
    );
    void broadcast(userChannel(originUserId), AGENT_CHAT_EVENT, {
      agentId: run.agentId,
    }).catch((error) =>
      console.warn("[agent-run] Agent Chat activity broadcast failed", error),
    );
  } else if (run.chatSession) {
    void broadcast(userChannel(run.chatSession.userId), AGENT_CHAT_EVENT, {
      sessionId: run.chatSession.id,
    }).catch((error) =>
      console.warn("[agent-run] chat activity broadcast failed", error),
    );
  }
}

export async function listAgentRunActivities(
  principal: AgentRunPrincipal,
  id: string,
) {
  const run = await prisma.agentRun.findFirst({
    where: accessibleRunWhere(principal, id),
    select: {
      activities: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: AGENT_RUN_ACTIVITY_LIST_LIMIT,
      },
    },
  });
  return run?.activities.reverse().map(serializeAgentRunActivity) ?? null;
}

export async function listTaskAgentRunActivities(
  userId: number,
  taskId: number,
) {
  const principal: AgentRunPrincipal = {
    userId,
    agentId: null,
    displayName: "",
    source: "browser",
  };
  if (!(await agentRunActivitiesEnabledFor(principal))) return [];

  const activities = await prisma.agentRunActivity.findMany({
    where: {
      type: { not: AgentRunActivityType.RESPONSE },
      run: {
        taskId,
        agent: { userId },
        task: {
          status: { not: Status.Deleted },
          project: {
            status: { not: Status.Deleted },
            ...projectContentAccessWhere(userId),
          },
        },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: AGENT_RUN_ACTIVITY_LIST_LIMIT,
  });

  return activities.reverse().map(serializeAgentRunActivity);
}

export async function createAgentRunActivity(
  principal: AgentRunPrincipal,
  id: string,
  input: AgentRunActivityInput,
  idempotencyKey: string | null,
  now = new Date(),
) {
  if (!principal.agentId) return null;
  const run = await findActivityRun(principal, id);
  if (!run) return null;

  if (idempotencyKey !== null) {
    const existing = await findIdempotentActivity(run.id, idempotencyKey);
    if (existing) return replayCreatedActivity(run, principal, existing, input);
  }
  if (!NONTERMINAL_AGENT_RUN_STATUSES.includes(run.status)) {
    throw new AgentRunNotActiveError("Run is no longer active");
  }

  const persistenceInput: AgentRunActivityPersistenceInput = {
    ...input,
    id: crypto.randomUUID(),
    runId: run.id,
    agentId: run.agentId,
    context: activityRunContext(run),
    idempotencyKey,
    createdAt: now,
  };
  let activity: AgentRunActivity | null = null;
  try {
    if (input.type === "RESPONSE" && run.task) {
      const { createCommentService } = await import(
        "@/utils/controllers/comments/createCommentService",
      );
      await createCommentService({
        text: toStoredHtml(input.text),
        creatorId: run.agent.user.id,
        taskId: run.task.id,
        ownerId: run.task.userId,
        currentUser: run.agent.user,
        agentId: run.agentId,
        accessUserId: principal.userId,
        agentRunActivity: persistenceInput,
      });
    } else if (input.type === "RESPONSE" && run.chatSession) {
      activity = await prisma.$transaction(async (tx) => {
        const target = await tx.chatMessage.findFirst({
          where: { sessionId: run.chatSession!.id },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true, role: true },
        });
        if (target?.role !== "human") throw new AgentRunNotActiveError("Run is no longer active");
        await tx.chatMessage.create({
          data: {
            sessionId: run.chatSession!.id,
            content: input.text,
            role: "assistant",
            isDelivered: true,
            replyToMessageId: target.id,
          },
        });
        const stored = await persistAgentRunActivity(tx, persistenceInput);
        await tx.chatSession.update({
          where: { id: run.chatSession!.id },
          data: { updatedAt: now },
        });
        return stored;
      });
    } else {
      activity = await prisma.$transaction((tx) =>
        persistAgentRunActivity(tx, persistenceInput),
      );
    }
  } catch (error) {
    if (idempotencyKey !== null && isUniqueConstraintError(error)) {
      const existing = await findIdempotentActivity(run.id, idempotencyKey);
      if (existing) return replayCreatedActivity(run, principal, existing, input);
    }
    if (run.chatSession && isUniqueConstraintError(error)) {
      throw new AgentRunNotActiveError("Run is no longer active");
    }
    throw error;
  }

  activity ??= await prisma.agentRunActivity.findUnique({
    where: { id: persistenceInput.id },
  });
  if (!activity) throw new Error("Agent run activity was not persisted");
  if (!run.task || input.type !== "RESPONSE") {
    broadcastActivityChange(run, principal.userId);
  }
  return { activity: serializeAgentRunActivity(activity), duplicate: false };
}

export async function selectAgentRunActivity(
  principal: AgentRunPrincipal,
  runId: string,
  activityId: string,
  selectedValue: string,
  now = new Date(),
) {
  if (principal.source !== "browser") return null;
  const run = await findActivityRun(principal, runId);
  if (!run) return null;
  const activity = await prisma.agentRunActivity.findFirst({
    where: { id: activityId, runId: run.id },
  });
  if (!activity) return null;
  if (activity.type !== "ELICITATION") {
    throw new AgentRunActivityInputError(
      "Only elicitation activities accept a selection",
    );
  }

  const options = storedAgentRunActivityOptions(activity.options);
  const option = options?.find(({ value }) => value === selectedValue);
  if (!option) {
    throw new AgentRunActivityInputError("value must match a stored option");
  }
  if (activity.selectedAt) {
    if (activity.selectedValue !== option.value) {
      throw new AgentRunSelectionConflictError(
        "This elicitation already has a different selection",
      );
    }
    // Older selections have no comment link, so they retain duplicate-only replay.
    if (run.task && activity.selectionCommentId) {
      if (!activity.selectedById) {
        throw new Error("Agent run selection creator was not persisted");
      }
      const selectedBy = await prisma.user.findUnique({
        where: { id: activity.selectedById },
        select: { id: true, email: true, displayName: true, photoURL: true },
      });
      if (!selectedBy) {
        throw new Error("Agent run selection creator was not found");
      }
      const { createCommentService } = await import(
        "@/utils/controllers/comments/createCommentService",
      );
      await createCommentService({
        text: toStoredHtml(activity.selectedLabel ?? option.label),
        creatorId: selectedBy.id,
        taskId: run.task.id,
        ownerId: run.task.userId,
        currentUser: selectedBy,
        accessUserId: principal.userId,
        agentRunReplayComment: {
          id: activity.selectionCommentId,
          activityId: activity.id,
          agentWebhookDeliveryIds: activity.commentAgentWebhookDeliveryIds,
          boardWebhookDeliveryIds: activity.commentBoardWebhookDeliveryIds,
          notificationsCompletedAt: activity.commentNotificationsCompletedAt,
        },
      });
    }
    return { activity: serializeAgentRunActivity(activity), duplicate: true };
  }
  if (!NONTERMINAL_AGENT_RUN_STATUSES.includes(run.status)) {
    throw new AgentRunNotActiveError("Run is no longer active");
  }

  const selectionInput: AgentRunSelectionPersistenceInput = {
    runId: run.id,
    agentId: run.agentId,
    activityId: activity.id,
    context: activityRunContext(run),
    option,
    selectedById: principal.userId,
    selectedAt: now,
  };
  if (run.task) {
    const { createCommentService } = await import(
      "@/utils/controllers/comments/createCommentService",
    );
    await createCommentService({
      text: toStoredHtml(option.label),
      creatorId: principal.userId,
      taskId: run.task.id,
      ownerId: run.task.userId,
      currentUser: {
        id: principal.userId,
        displayName: principal.displayName,
      },
      accessUserId: principal.userId,
      agentRunSelection: selectionInput,
    });
  } else if (run.chatSession) {
    const deliveryIds = await prisma.$transaction(async (tx) => {
      const selectedRun = await persistAgentRunSelection(tx, selectionInput);
      const message = await tx.chatMessage.create({
        data: {
          sessionId: run.chatSession!.id,
          content: option.label,
          role: "human",
          isDelivered: true,
        },
      });
      await tx.chatSession.update({
        where: { id: run.chatSession!.id },
        data: { updatedAt: now },
      });
      const deliveryId = await persistAgentWebhookEvent(tx, {
        event: "run.prompted",
        agentId: run.agentId,
        projectId: null,
        taskId: null,
        ticketNumber: null,
        taskTitle: null,
        actor: {
          userId: principal.userId,
          displayName: principal.displayName,
        },
        runId: run.id,
        run: serializeAgentRun(selectedRun),
        prompt: option.label,
        signal: "select",
        selection: {
          activityId: activity.id,
          value: option.value,
          label: option.label,
        },
        chat: {
          sessionId: run.chatSession!.id,
          messageId: message.id,
          text: option.label,
          userName: principal.displayName,
        },
      });
      return deliveryId ? [deliveryId] : [];
    });
    await publishAgentWebhookDeliveries(deliveryIds);
  }

  const selected = await prisma.agentRunActivity.findUnique({
    where: { id: activity.id },
  });
  if (!selected) throw new Error("Agent run activity selection was not persisted");
  if (!run.task) broadcastActivityChange(run, principal.userId);
  return { activity: serializeAgentRunActivity(selected), duplicate: false };
}
