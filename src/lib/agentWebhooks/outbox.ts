import crypto from "crypto";
import type { AgentRun, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import {
  AGENT_RUN_FEATURE_FLAG,
  NONTERMINAL_AGENT_RUN_STATUSES,
  type AgentRunContext,
  agentRunContextForEvent,
  agentRunPromptForEvent,
  agentRunTriggerForEvent,
  serializeAgentRun,
} from "@/lib/agentRuns/model";
import type {
  AgentWebhookEventInput,
  AgentWebhookPayload,
} from "./events";
import type {
  AgentWebhookActor,
  AgentWebhookTaskChanges,
  AgentWebhookTaskLabel,
} from "./events";
import { queueAgentWebhookDelivery } from "./queue";

type AgentWebhookTransaction = Pick<
  Prisma.TransactionClient,
  | "agentWebhookSubscription"
  | "agentWebhookDelivery"
  | "agentRun"
  | "featureFlag"
  | "user"
>;

type EligibleAgentWebhookSubscription = {
  id: string;
  projectId: number | null;
  events: string[];
  agent: { userId: number };
};

async function findEligibleAgentWebhookSubscription(
  tx: AgentWebhookTransaction,
  agentId: string,
  projectId: number | null,
): Promise<EligibleAgentWebhookSubscription | null> {
  const subscription = await tx.agentWebhookSubscription.findUnique({
    where: { agentId },
    select: {
      id: true,
      active: true,
      projectId: true,
      events: true,
      agent: {
        select: {
          userId: true,
          revokedAt: true,
          members: {
            where: projectId === null ? {} : { projectId },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });

  if (
    !subscription?.active ||
    subscription.agent.revokedAt != null ||
    subscription.agent.members.length === 0 ||
    (projectId !== null &&
      subscription.projectId != null &&
      subscription.projectId !== projectId)
  ) {
    return null;
  }
  return subscription;
}

/** Persist one event inside the caller's domain transaction. */
export async function persistAgentWebhookEvent(
  tx: AgentWebhookTransaction,
  input: AgentWebhookEventInput,
): Promise<string | null> {
  const subscription = await findEligibleAgentWebhookSubscription(
    tx,
    input.agentId,
    input.projectId,
  );
  if (!subscription?.events.includes(input.event)) return null;

  return createAgentWebhookDelivery(tx, subscription.id, input.agentId, input);
}

/** Publish only after the transaction commits; a failure remains sweepable. */
export async function publishAgentWebhookDeliveries(
  deliveryIds: Array<string | null>,
): Promise<void> {
  await Promise.all(
    deliveryIds.filter((id): id is string => Boolean(id)).map((deliveryId) =>
      queueAgentWebhookDelivery(deliveryId).catch((error) => {
        console.warn(
          "[agent-webhook] queue publish failed; sweep will retry",
          error,
        );
      }),
    ),
  );
}

export async function replayAgentWebhookDelivery(input: {
  deliveryId: string;
  subscriptionId: string;
}): Promise<string | null> {
  const source = await prisma.agentWebhookDelivery.findFirst({
    where: { id: input.deliveryId, subscriptionId: input.subscriptionId },
    select: { event: true, payload: true },
  });
  if (!source) return null;

  const deliveryId = crypto.randomUUID();
  const sourcePayload = source.payload as Record<string, unknown>;
  const payload = { ...sourcePayload, deliveryId };
  await prisma.agentWebhookDelivery.create({
    data: {
      id: deliveryId,
      subscriptionId: input.subscriptionId,
      event: source.event,
      payload: payload as Prisma.InputJsonValue,
    },
  });
  await queueAgentWebhookDelivery(deliveryId).catch((error) => {
    console.warn("[agent-webhook] replay queue publish failed; sweep will retry", error);
  });
  return deliveryId;
}

export async function createAgentWebhookTestDelivery(input: {
  subscriptionId: string;
  agentId: string;
  projectId: number | null;
}): Promise<string> {
  const deliveryId = crypto.randomUUID();
  const payload = {
    event: "webhook.test",
    deliveryId,
    occurredAt: new Date().toISOString(),
    agentId: input.agentId,
    projectId: input.projectId,
    test: true,
    message: "Hypertask webhook test delivery",
  };
  await prisma.agentWebhookDelivery.create({
    data: {
      id: deliveryId,
      subscriptionId: input.subscriptionId,
      event: "webhook.test",
      payload: payload as Prisma.InputJsonValue,
    },
  });
  await queueAgentWebhookDelivery(deliveryId).catch((error) => {
    console.warn("[agent-webhook] test queue publish failed; sweep will retry", error);
  });
  return deliveryId;
}

export type AgentWebhookActorInput = {
  userId: number;
  agentId?: string | null;
  displayName?: string | null;
};

/** Record the recoverable post-create handoff in the task's creation transaction. */
export async function persistAgentTaskCreatedPending(
  tx: Prisma.TransactionClient,
  taskId: number,
): Promise<void> {
  await tx.task.update({
    where: { id: taskId },
    data: {
      agentTaskCreatedPendingAt: new Date(),
      agentTaskCreatedReadyAt: null,
      agentTaskCreatedEmittedAt: null,
    },
  });
}

/** Mark the handoff ready only after post-create assignment has completed. */
export async function markAgentTaskCreatedReady(taskId: number): Promise<boolean> {
  const updated = await prisma.$executeRaw`
    UPDATE "Task"
    SET "agentTaskCreatedReadyAt" = now()
    WHERE "id" = ${taskId}
      AND "agentTaskCreatedPendingAt" IS NOT NULL
      AND "agentTaskCreatedReadyAt" IS NULL
      AND "agentTaskCreatedEmittedAt" IS NULL
  `;
  return updated > 0;
}

/** Requeue a failed handoff so repeated failures do not starve newer rows. */
export async function ensurePendingAgentTaskCreatedWebhook(
  taskId: number,
): Promise<boolean> {
  const updated = await prisma.$executeRaw`
    UPDATE "Task"
    SET "agentTaskCreatedPendingAt" = now()
    WHERE "id" = ${taskId}
      AND "agentTaskCreatedEmittedAt" IS NULL
  `;
  return updated > 0;
}

// Broadcast targets always carry a real board: task events are board scoped.
type AgentWebhookBroadcastInput = Omit<AgentWebhookEventInput, "agentId" | "projectId"> & {
  projectId: number;
} &
  (
    | { broadcast: false; agentIds: readonly string[] }
    | { broadcast: true; agentIds?: never }
  );

async function resolveAgentWebhookActor(
  tx: Prisma.TransactionClient,
  input: AgentWebhookActorInput,
): Promise<AgentWebhookActor> {
  let displayName = "";
  if (input.agentId) {
    const agent = await tx.agent.findUnique({
      where: { id: input.agentId },
      select: { displayName: true },
    });
    displayName = agent?.displayName?.trim() || "";
  }
  if (!displayName) {
    displayName = input.displayName?.trim() || "";
  }
  if (!displayName) {
    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { displayName: true },
    });
    displayName = user?.displayName?.trim() || "";
  }
  return {
    userId: input.userId,
    agentId: input.agentId ?? null,
    displayName: displayName || "Hypertask user",
  };
}

async function filterTaskLabelsForProject(
  tx: Prisma.TransactionClient,
  projectId: number,
  labels: readonly AgentWebhookTaskLabel[],
): Promise<AgentWebhookTaskLabel[]> {
  if (labels.length === 0) return [];

  const labelIds = [...new Set(labels.map(({ id }) => id))];
  const projectLabels = await tx.label.findMany({
    where: { id: { in: labelIds }, projectId },
    select: { id: true, value: true },
  });
  const labelsById = new Map(projectLabels.map((label) => [label.id, label]));

  // Map the original array so valid duplicate entries keep their order and
  // cardinality. A historical label remains in the payload while it resolves
  // to this project. Omit deleted or cross-project rows instead of leaking
  // unverified label data into a board-scoped webhook.
  const filteredLabels = labels.flatMap(({ id }) => {
    const label = labelsById.get(id);
    return label ? [{ id: label.id, value: label.value }] : [];
  });
  if (filteredLabels.length !== labels.length) {
    console.warn("[agent-webhook] omitted labels outside the task board scope", {
      projectId,
      omittedCount: labels.length - filteredLabels.length,
      reason: "deleted-or-cross-project",
      labelIds,
    });
  }
  return filteredLabels;
}

function taskLabelsWereRedacted(
  original: readonly AgentWebhookTaskLabel[],
  filtered: readonly AgentWebhookTaskLabel[],
): boolean {
  // filterTaskLabelsForProject preserves order and duplicates. A shorter
  // result therefore means that one or more rows were omitted.
  return original.length !== filtered.length;
}

async function filterTaskWebhookChangesForProject(
  tx: Prisma.TransactionClient,
  projectId: number,
  changes: AgentWebhookTaskChanges,
): Promise<{ changes: AgentWebhookTaskChanges; labelsRedacted: boolean }> {
  if (!changes.labels) return { changes, labelsRedacted: false };

  const [from, to] = await Promise.all([
    filterTaskLabelsForProject(tx, projectId, changes.labels.from),
    filterTaskLabelsForProject(tx, projectId, changes.labels.to),
  ]);
  const labelsRedacted =
    taskLabelsWereRedacted(changes.labels.from, from) ||
    taskLabelsWereRedacted(changes.labels.to, to);
  return {
    changes: { ...changes, labels: { from, to } },
    labelsRedacted,
  };
}

async function createAgentWebhookDelivery(
  tx: AgentWebhookTransaction,
  subscriptionId: string,
  agentId: string,
  input: Omit<AgentWebhookEventInput, "agentId">,
): Promise<string> {
  const deliveryId = crypto.randomUUID();
  const payload: AgentWebhookPayload = {
    ...input,
    agentId,
    deliveryId,
    occurredAt: new Date().toISOString(),
  };

  await tx.agentWebhookDelivery.create({
    data: {
      id: deliveryId,
      subscriptionId,
      event: input.event,
      payload: payload as unknown as Prisma.InputJsonValue,
    },
  });
  return deliveryId;
}

type AgentRunTriggerEventInput = AgentWebhookEventInput & {
  event: "comment.mention" | "task.assigned" | "chat.message";
};

function nonterminalRunWhere(
  agentId: string,
  context: AgentRunContext,
) {
  return {
    agentId,
    ...context,
    status: { in: NONTERMINAL_AGENT_RUN_STATUSES },
  } as const;
}

async function createOrReactivateAgentRun(
  tx: AgentWebhookTransaction,
  input: AgentRunTriggerEventInput,
  now: Date,
): Promise<{ created: boolean; run: AgentRun }> {
  const trigger = agentRunTriggerForEvent(input.event);
  const context = agentRunContextForEvent(input);
  if (!trigger || !context) {
    throw new Error(`Agent run trigger ${input.event} is missing its context`);
  }

  const data = {
    id: crypto.randomUUID(),
    agentId: input.agentId,
    ...context,
    trigger,
    status: "ACTIVE" as const,
    createdAt: now,
    lastActivityAt: now,
    chatPromptMessageId: input.event === "chat.message" ? input.chat!.messageId : null,
  };
  let inserted = await tx.agentRun.createMany({ data: [data], skipDuplicates: true });
  let created = inserted.count === 1;

  if (!created) {
    const reactivated = await tx.agentRun.updateMany({
      where: nonterminalRunWhere(input.agentId, context),
      data: { status: "ACTIVE", lastActivityAt: now, chatPromptMessageId: data.chatPromptMessageId },
    });
    if (reactivated.count === 0) {
      // A stop can win between the skipped insert and guarded update. In that
      // ordering this interaction starts a new run rather than reviving STOPPED.
      inserted = await tx.agentRun.createMany({ data: [data], skipDuplicates: true });
      created = inserted.count === 1;
      if (!created) {
        const retry = await tx.agentRun.updateMany({
          where: nonterminalRunWhere(input.agentId, context),
          data: { status: "ACTIVE", lastActivityAt: now, chatPromptMessageId: data.chatPromptMessageId },
        });
        if (retry.count === 0) {
          throw new Error("Agent run changed while recording its interaction");
        }
      }
    }
  }

  const run = await tx.agentRun.findFirst({
    where: nonterminalRunWhere(input.agentId, context),
  });
  if (!run) throw new Error("Agent run was not persisted");
  return { created, run };
}

/**
 * Persist a trigger plus its run lifecycle event in the source transaction.
 * Feature-off callers retain the legacy payload and one-delivery return shape.
 */
export async function persistAgentRunTriggerWebhooks(
  tx: AgentWebhookTransaction,
  input: AgentRunTriggerEventInput,
  now = new Date(),
): Promise<string[]> {
  const subscription = await findEligibleAgentWebhookSubscription(
    tx,
    input.agentId,
    input.projectId,
  );
  if (!subscription) return [];

  const triggerSubscribed = subscription.events.includes(input.event);
  const runsEnabled = await isFeatureEnabled(
    AGENT_RUN_FEATURE_FLAG,
    subscription.agent.userId,
    tx,
  );
  if (!runsEnabled) {
    return triggerSubscribed
      ? [
          await createAgentWebhookDelivery(
            tx,
            subscription.id,
            input.agentId,
            input,
          ),
        ]
      : [];
  }

  const lifecycleSubscribed = subscription.events.some((event) =>
    event.startsWith("run."),
  );
  if (!triggerSubscribed && !lifecycleSubscribed) return [];

  const { created, run } = await createOrReactivateAgentRun(tx, input, now);
  const runPayload = serializeAgentRun(run);
  const deliveryIds = triggerSubscribed
    ? [
        await createAgentWebhookDelivery(tx, subscription.id, input.agentId, {
          ...input,
          runId: run.id,
        }),
      ]
    : [];
  const prompt = agentRunPromptForEvent(input);
  let lifecycleEvent: "run.created" | "run.prompted" | null = null;
  if (created) {
    lifecycleEvent = "run.created";
  } else if (prompt != null) {
    lifecycleEvent = "run.prompted";
  }
  if (lifecycleEvent && subscription.events.includes(lifecycleEvent)) {
    deliveryIds.push(
      await createAgentWebhookDelivery(tx, subscription.id, input.agentId, {
        ...input,
        event: lifecycleEvent,
        runId: run.id,
        run: runPayload,
        prompt,
      }),
    );
  }
  return deliveryIds;
}

export type AgentTaskRunPromptInput = {
  projectId: number;
  taskId: number;
  ticketNumber: string | null;
  taskTitle: string;
  commentId: number;
  commentHtml: string;
  actor: AgentWebhookActor;
  excludeAgentIds?: readonly string[];
};

/** Prompt every still-addressable run on a task after a human follow-up. */
export async function persistAgentTaskRunPromptWebhooks(
  tx: AgentWebhookTransaction,
  input: AgentTaskRunPromptInput,
  now = new Date(),
): Promise<string[]> {
  const excluded = new Set(input.excludeAgentIds ?? []);
  const runs = await tx.agentRun.findMany({
    where: {
      taskId: input.taskId,
      status: { in: NONTERMINAL_AGENT_RUN_STATUSES },
    },
    select: {
      id: true,
      agentId: true,
      taskId: true,
      chatSessionId: true,
      trigger: true,
      status: true,
      createdAt: true,
      lastActivityAt: true,
      stoppedById: true,
      agent: {
        select: {
          userId: true,
          revokedAt: true,
          members: {
            where: { projectId: input.projectId },
            select: { id: true },
            take: 1,
          },
          agentWebhookSubscription: {
            select: { id: true, projectId: true, active: true, events: true },
          },
        },
      },
    },
  });

  const deliveryIds: string[] = [];
  for (const run of runs) {
    if (excluded.has(run.agentId)) continue;
    const subscription = run.agent.agentWebhookSubscription;
    if (
      run.agent.revokedAt !== null ||
      run.agent.members.length === 0 ||
      !subscription?.active ||
      !subscription.events.includes("run.prompted") ||
      (subscription.projectId !== null &&
        subscription.projectId !== input.projectId) ||
      !(await isFeatureEnabled(
        AGENT_RUN_FEATURE_FLAG,
        run.agent.userId,
        tx,
      ))
    ) {
      continue;
    }

    const updated = await tx.agentRun.updateMany({
      where: {
        id: run.id,
        status: { in: NONTERMINAL_AGENT_RUN_STATUSES },
      },
      data: { status: "ACTIVE", lastActivityAt: now },
    });
    if (updated.count === 0) continue;

    const activeRun = {
      ...run,
      status: "ACTIVE" as const,
      lastActivityAt: now,
    };
    deliveryIds.push(
      await createAgentWebhookDelivery(tx, subscription.id, run.agentId, {
        event: "run.prompted",
        projectId: input.projectId,
        taskId: input.taskId,
        ticketNumber: input.ticketNumber,
        taskTitle: input.taskTitle,
        commentId: input.commentId,
        commentHtml: input.commentHtml,
        actor: input.actor,
        runId: run.id,
        run: serializeAgentRun(activeRun),
        prompt: input.commentHtml,
      }),
    );
  }
  return deliveryIds;
}

/** Persist the terminal lifecycle callback after a guarded stop update. */
export async function persistAgentRunStoppedWebhook(
  tx: AgentWebhookTransaction,
  input: Omit<AgentWebhookEventInput, "event">,
): Promise<string | null> {
  return persistAgentWebhookEvent(tx, { ...input, event: "run.stopped" });
}

/** Persist one event for every active agent subscription in the task's board scope. */
export async function persistAgentWebhookEvents(
  tx: AgentWebhookTransaction,
  input: AgentWebhookBroadcastInput,
): Promise<string[]> {
  const { agentIds, broadcast, ...eventInput } = input;
  const targetAgentIds = broadcast
    ? undefined
    : [...new Set(agentIds)];
  if (targetAgentIds?.length === 0) return [];

  const subscriptions = await tx.agentWebhookSubscription.findMany({
    where: {
      active: true,
      events: { has: input.event },
      ...(targetAgentIds ? { agentId: { in: targetAgentIds } } : {}),
      agent: {
        revokedAt: null,
        // Match the legacy single-target rule for every subscription: a
        // subscription project narrows delivery, and membership grants access.
        // A null subscription project is an explicit all-board subscription.
        members: { some: { projectId: input.projectId } },
      },
      OR: [{ projectId: null }, { projectId: input.projectId }],
    },
    select: { id: true, agentId: true },
  });

  return Promise.all(
    subscriptions
      .filter(
        (subscription): subscription is typeof subscription & { agentId: string } =>
          typeof subscription.agentId === "string" && subscription.agentId.length > 0,
      )
      .map((subscription) =>
        createAgentWebhookDelivery(
          tx,
          subscription.id,
          subscription.agentId,
          eventInput,
        ),
      ),
  );
}

type AgentTaskWebhookInput = {
  taskId: number;
  actor: AgentWebhookActorInput;
};

type AgentTaskCreatedWebhookInput = {
  taskId: number;
  actor?: AgentWebhookActorInput;
};

export async function persistAgentTaskUpdatedWebhook(
  tx: Prisma.TransactionClient,
  input: AgentTaskWebhookInput & { changes: AgentWebhookTaskChanges },
): Promise<string[]> {
  // The task row supplies the only project scope used below. Callers pass a
  // task ID, not a second project ID that could disagree with this row.
  if (Object.keys(input.changes).length === 0) return [];
  const task = await tx.task.findUnique({
    where: { id: input.taskId },
    select: {
      id: true,
      ticketNumber: true,
      projectId: true,
      title: true,
    },
  });
  if (!task) return [];

  const actor = await resolveAgentWebhookActor(tx, input.actor);
  const filteredChanges = await filterTaskWebhookChangesForProject(
    tx,
    task.projectId,
    input.changes,
  );
  return persistAgentWebhookEvents(tx, {
    event: "task.updated",
    taskId: task.id,
    projectId: task.projectId,
    ticketNumber: task.ticketNumber,
    taskTitle: task.title,
    actor,
    changes: filteredChanges.changes,
    ...(filteredChanges.labelsRedacted ? { labelsRedacted: true } : {}),
    broadcast: true,
  });
}

export async function emitAgentTaskUpdatedWebhook(
  input: AgentTaskWebhookInput & { changes: AgentWebhookTaskChanges },
): Promise<void> {
  const deliveryIds = await prisma.$transaction((tx) =>
    persistAgentTaskUpdatedWebhook(tx, input),
  );
  await publishAgentWebhookDeliveries(deliveryIds);
}

export async function persistAgentTaskCreatedWebhook(
  tx: Prisma.TransactionClient,
  input: AgentTaskCreatedWebhookInput,
): Promise<string[]> {
  // Lock the task while building the outbox rows. The emitted marker is set
  // only after those rows exist in this transaction. A concurrent request or
  // sweep waits for the lock, then sees the committed marker and does nothing.
  // Any failure before commit rolls back both the rows and the marker, so the
  // recovery sweep can retry the handoff.
  const claimed = await tx.$queryRaw<Array<{ id: number }>>`
    SELECT "id"
    FROM "Task"
    WHERE "id" = ${input.taskId}
      AND "agentTaskCreatedPendingAt" IS NOT NULL
      AND "agentTaskCreatedReadyAt" IS NOT NULL
      AND "agentTaskCreatedEmittedAt" IS NULL
    FOR UPDATE
  `;
  if (claimed.length === 0) return [];

  // Read the task and derive its project inside the caller's transaction so a
  // stale task ID cannot redirect this event to a caller-supplied board.
  const task = await tx.task.findUnique({
    where: { id: input.taskId },
    select: {
      id: true,
      ticketNumber: true,
      projectId: true,
      title: true,
      userId: true,
      agentId: true,
      assignees: { select: { userId: true, agentId: true } },
      taskLabels: {
        select: {
          label: { select: { id: true, value: true } },
        },
      },
    },
  });
  if (!task) return [];

  // Request paths pass the triggering actor explicitly. Recovery sweeps omit
  // it and intentionally use the task creator stored on the task row.
  const actorInput = input.actor ?? {
    userId: task.userId,
    agentId: task.agentId,
  };
  const actor = await resolveAgentWebhookActor(tx, actorInput);
  const labels = await filterTaskLabelsForProject(
    tx,
    task.projectId,
    task.taskLabels.map(({ label }) => label),
  );
  const deliveryIds = await persistAgentWebhookEvents(tx, {
    event: "task.created",
    taskId: task.id,
    projectId: task.projectId,
    ticketNumber: task.ticketNumber,
    taskTitle: task.title,
    actor,
    assignees: task.assignees.map(({ userId, agentId }) => ({
      userId,
      agentId,
    })),
    labels,
    ...(taskLabelsWereRedacted(
      task.taskLabels.map(({ label }) => label),
      labels,
    )
      ? { labelsRedacted: true }
      : {}),
    broadcast: true,
  });
  await tx.task.update({
    where: { id: task.id },
    data: {
      agentTaskCreatedPendingAt: null,
      agentTaskCreatedReadyAt: null,
      agentTaskCreatedEmittedAt: new Date(),
    },
  });
  return deliveryIds;
}

export async function emitAgentTaskCreatedWebhook(
  input: AgentTaskCreatedWebhookInput,
): Promise<void> {
  const deliveryIds = await prisma.$transaction((tx) =>
    persistAgentTaskCreatedWebhook(tx, input),
  );
  await publishAgentWebhookDeliveries(deliveryIds);
}
