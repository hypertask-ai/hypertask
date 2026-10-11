import { configureAiModelUsage } from "@/app/api/ai/_lib/modelProvider";
import { waitUntil } from "@vercel/functions";
import { generateText } from "ai";

import { getTeamGatewayApiKey, resolveAutomaticAiModel } from "@/app/api/ai/_lib/byokKeys";
import { batchBackgroundAiEnabled, haikuDefaultModelEnabled } from "@/app/api/ai/_lib/planGate";
import { gatewayCatalogModelSlug } from "@/app/api/ai/_lib/sharedAllowance";
import { batchEligibleFunding, batchEligibleModel, labelTaskContentHash } from "@/lib/ai/batch/batchJobs";
import { submitSmartLabelBatch } from "@/lib/ai/labelClassifierBatch";
import {
  gatewayFundingSourceForApiKey,
  gatewayProviderOptionsForModel,
  resolveGatewayModel,
} from "@/app/api/ai/_lib/modelProvider";
import { convertHtmlToText } from "@/app/api/ai/_lib/taskContent";
import { generalConfig } from "@/lib/configs/general.config";
import {
  LABEL_CLASSIFIER_INSTRUCTIONS,
  LABEL_CLASSIFIER_MAX_OUTPUT_TOKENS,
  labelClassifierPrompt,
  parseMatchingLabelIds,
  type AiLabelDefinition,
} from "@/lib/ai/labelClassifierOutput";
import prisma from "@/lib/prisma";
import { broadcastBoardChange } from "@/lib/realtime/server";
import {
  persistAgentTaskUpdatedWebhook,
  publishAgentWebhookDeliveries,
} from "@/lib/agentWebhooks/outbox";
import type { IUser } from "@/models/model";
import createLabelActivity from "@/utils/controllers/activities/createLabelActivity";

const MODEL = "google/gemini-3.1-flash-lite";
const BACKFILL_LIMIT = 500;
const BACKFILL_CONCURRENCY = 5;

export { parseMatchingLabelIds } from "@/lib/ai/labelClassifierOutput";
export type { AiLabelDefinition } from "@/lib/ai/labelClassifierOutput";

export type LabelClassifierTask = {
  title: string;
  description: string;
};

export async function classifyTaskAgainstLabels(
  task: LabelClassifierTask,
  definitions: AiLabelDefinition[],
  tags?: {
    userId?: number | null;
    projectId?: number | null;
    teamId?: string | null;
    taskId?: number | null;
    agentId?: string | null;
  }
): Promise<string[] | null> {
  if (definitions.length === 0) return [];

  if (!tags?.teamId) {
    console.error("[labelClassifier] Skipping inference: task has no owning team");
    return null;
  }

  let gatewayApiKey: string | undefined;
  try {
    gatewayApiKey = await getTeamGatewayApiKey({ trustedTeamId: tags.teamId });
  } catch (error) {
    console.error(
      `[labelClassifier] Skipping inference: team gateway key lookup failed for ${tags.teamId}`,
      error,
    );
    return null;
  }
  if (!gatewayApiKey) {
    console.error(
      `[labelClassifier] Skipping inference: no dedicated gateway key for team ${tags.teamId}`,
    );
    return null;
  }

  const haikuDefaultEnabled = await haikuDefaultModelEnabled(tags?.userId);
  const model = haikuDefaultEnabled
    ? resolveAutomaticAiModel("gateway", "anthropic/claude-haiku-5.5", gatewayApiKey, {
        haiku55Enabled: true,
        lookup: { trustedTeamId: tags.teamId, projectId: tags.projectId, userId: tags.userId ?? 0 },
        feature: "smart-label",
      })
    : resolveGatewayModel(MODEL, gatewayApiKey);
  configureAiModelUsage(model, {
    userId: haikuDefaultEnabled ? tags?.userId ?? 0 : tags?.userId ?? generalConfig.hyperAiId,
    teamId: tags?.teamId,
    projectId: tags?.projectId,
    taskId: tags?.taskId,
    agentId: tags?.agentId,
    provider: haikuDefaultEnabled ? "anthropic" : "google",
    feature: "smart-label",
  });
  const result = await generateText({
    model,
    instructions: LABEL_CLASSIFIER_INSTRUCTIONS,
    prompt: labelClassifierPrompt(task, definitions),
    maxRetries: 2,
    maxOutputTokens: LABEL_CLASSIFIER_MAX_OUTPUT_TOKENS,
    providerOptions: gatewayProviderOptionsForModel(
      model,
      "smart-label",
      tags
    ),
  });

  const matchingLabelIds = parseMatchingLabelIds(
    result.text.trim(),
    definitions,
  );
  if (matchingLabelIds === null) {
    console.error(
      "[labelClassifier] Skipping result: model returned unparsable label output",
    );
  }
  return matchingLabelIds;
}

export async function getAiActor(): Promise<IUser> {
  const hyperAi = await prisma.user.findUnique({
    where: { id: generalConfig.hyperAiId },
  });
  return (hyperAi ?? {
    id: generalConfig.hyperAiId,
    displayName: "HyperAI",
  }) as IUser;
}

export async function applyAiLabelVerdict({
  taskId,
  projectId,
  definitions,
  matchingLabelIds,
  actor,
  snapshotAt,
  contentHash,
}: {
  taskId: number;
  projectId: number;
  definitions: AiLabelDefinition[];
  matchingLabelIds: string[];
  actor: IUser;
  snapshotAt: Date;
  /**
   * HTPR-7098: batch results arrive hours later and any edit bumps updatedAt, so a batch verdict is
   * stale only when the title or description the model saw has changed. Instant path leaves this unset.
   */
  contentHash?: string;
}) {
  // The task may have been edited, moved, or archived while classification
  // was in flight. Don't let a stale verdict overwrite newer state.
  const currentTask = await prisma.task.findFirst({
    where: { id: taskId, projectId, status: "Normal" },
    select: { updatedAt: true, title: true, description: true, description_: { select: { content: true } } },
  });
  if (!currentTask?.updatedAt) return;
  if (contentHash) {
    const currentHash = labelTaskContentHash({
      title: currentTask.title,
      description: convertHtmlToText(currentTask.description_?.content || currentTask.description || ""),
    });
    if (currentHash !== contentHash) return "stale";
  } else if (currentTask.updatedAt.getTime() > snapshotAt.getTime()) return;

  const currentLabels = await prisma.label.findMany({
    where: {
      id: { in: definitions.map(({ labelId }) => labelId) },
      ai_prompt: { not: null },
    },
    select: { id: true, ai_prompt: true },
  });
  const currentPrompts = new Map(
    currentLabels.map(({ id, ai_prompt }) => [id, ai_prompt?.trim()])
  );
  const activeDefinitions = definitions.filter(
    ({ labelId, prompt }) => currentPrompts.get(labelId) === prompt
  );
  if (activeDefinitions.length === 0) return;

  const aiLabelIds = activeDefinitions.map(({ labelId }) => labelId);
  const matchingIds = new Set(matchingLabelIds);
  const result = await prisma.$transaction(async (tx) => {
    // The task can move after the optimistic check above. Lock it and repeat
    // the board, status, and freshness checks before attaching board labels.
    const lockedTasks = contentHash
      ? await tx.$queryRaw<Array<{ id: number }>>`
      SELECT "id"
      FROM "Task"
      WHERE "id" = ${taskId}
        AND "projectId" = ${projectId}
        AND "status" = 'Normal'
      FOR UPDATE
    `
      : await tx.$queryRaw<Array<{ id: number }>>`
      SELECT "id"
      FROM "Task"
      WHERE "id" = ${taskId}
        AND "projectId" = ${projectId}
        AND "status" = 'Normal'
        AND "updatedAt" <= ${snapshotAt}
      FOR UPDATE
    `;
    if (lockedTasks.length === 0) {
      return { changed: false, deliveryIds: [] as string[] };
    }
    if (contentHash) {
      // HTPR-7098: the check before the transaction can be overtaken by an edit, so repeat it on the
      // locked row. The edit that comes after the lock waits for us and the next classification covers it.
      const locked = await tx.task.findUnique({
        where: { id: taskId },
        select: { title: true, description: true, description_: { select: { content: true } } },
      });
      if (!locked) return { changed: false, deliveryIds: [] as string[] };
      if (
        labelTaskContentHash({
          title: locked.title,
          description: convertHtmlToText(locked.description_?.content || locked.description || ""),
        }) !== contentHash
      ) {
        return "stale" as const;
      }
    }

    const existing = await tx.taskLabel.findMany({
      where: { taskId, labelId: { in: aiLabelIds } },
      include: { label: true },
    });
    const labelsBefore = await tx.taskLabel.findMany({
      where: { taskId },
      include: { label: true },
    });
    const existingIds = new Set(existing.map(({ labelId }) => labelId));
    const toAdd = aiLabelIds.filter(
      (labelId) => matchingIds.has(labelId) && !existingIds.has(labelId)
    );
    const toRemove = existing.filter(({ labelId }) => !matchingIds.has(labelId));

    // V1 intentionally lets the latest AI verdict win over manual changes.
    for (const labelId of toAdd) {
      const taskLabel = await tx.taskLabel.upsert({
        where: { taskId_labelId: { taskId, labelId } },
        create: { taskId, labelId },
        update: {},
        include: { label: true },
      });
      await createLabelActivity({
        userObj: actor,
        toTaskLabel: taskLabel as any,
        taskId,
        status: "Assigned",
        transaction: tx,
      });
    }

    for (const taskLabel of toRemove) {
      await tx.taskLabel.deleteMany({
        where: { taskId, labelId: taskLabel.labelId },
      });
      await createLabelActivity({
        userObj: actor,
        toTaskLabel: taskLabel as any,
        taskId,
        status: "Removed",
        transaction: tx,
      });
    }

    if (toAdd.length === 0 && toRemove.length === 0) {
      return { changed: false, deliveryIds: [] as string[] };
    }

    const labelsAfter = await tx.taskLabel.findMany({
      where: { taskId },
      include: { label: true },
    });
    const deliveryIds = await persistAgentTaskUpdatedWebhook(tx, {
      taskId,
      actor: {
        userId: actor.id,
        displayName: actor.displayName,
      },
      changes: {
        labels: {
          from: labelsBefore.map(({ label }) => ({ id: label.id, value: label.value })),
          to: labelsAfter.map(({ label }) => ({ id: label.id, value: label.value })),
        },
      },
    });
    return { changed: true, deliveryIds };
  });

  if (result === "stale") return result;
  const { changed, deliveryIds } = result;
  if (changed) {
    try {
      await publishAgentWebhookDeliveries(deliveryIds);
    } catch (error) {
      // The outbox rows committed with the label mutation. The queue helper
      // and the scheduled agent-webhook sweep retry publication failures.
      console.warn("[labelClassifier] agent task.updated queue publish failed; outbox sweep will retry", error);
    }
    void broadcastBoardChange(projectId, { originUserId: actor.id });
  }
}

/**
 * HTPR-7098: one instant classification for a batch item that came back failed, expired or
 * unparsable. Same prompt and the same freshness check as the normal instant path.
 */
export async function classifyLabelItemInstantly(
  taskId: number,
  projectId: number,
  definitions: AiLabelDefinition[],
) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, projectId, status: "Normal" },
    select: {
      id: true,
      title: true,
      description: true,
      userId: true,
      agentId: true,
      projectId: true,
      updatedAt: true,
      description_: { select: { content: true } },
      project: { select: { teamId: true } },
    },
  });
  if (!task?.updatedAt) return;
  await classifyTaskWithDefinitions({
    task,
    definitions,
    actor: await getAiActor(),
    snapshotAt: task.updatedAt,
  });
}

async function classifyTaskWithDefinitions({
  task,
  definitions,
  actor,
  snapshotAt,
}: {
  task: {
    id: number;
    title: string;
    description: string | null;
    userId: number;
    agentId: string | null;
    projectId: number;
    description_: { content: string } | null;
    project: { teamId: string | null };
  };
  definitions: AiLabelDefinition[];
  actor: IUser;
  snapshotAt: Date;
}) {
  const matchingLabelIds = await classifyTaskAgainstLabels(
    {
      title: task.title,
      description: convertHtmlToText(
        task.description_?.content || task.description || ""
      ),
    },
    definitions,
    {
      userId: task.userId,
      projectId: task.projectId,
      teamId: task.project.teamId,
      taskId: task.id,
      agentId: task.agentId,
    }
  );
  if (matchingLabelIds === null) return;
  await applyAiLabelVerdict({
    taskId: task.id,
    projectId: task.projectId,
    definitions,
    matchingLabelIds,
    actor,
    snapshotAt,
  });
}

// Fire-and-forget entry points. waitUntil keeps the serverless instance alive
// until classification finishes (same reason as broadcastBoardChange, HTPR-3999);
// a bare floating promise dies when the response returns.
export function scheduleClassifyTaskAiLabels(taskId: number, projectId: number) {
  waitUntil(classifyTaskAiLabels(taskId, projectId).catch(console.error));
}

/** `userId` is the person who created or changed the label; HTPR-7098 checks its flag for the batch path. */
export function scheduleBackfillAiLabel(labelId: string, userId?: number) {
  waitUntil(backfillAiLabel(labelId, userId).catch(console.error));
}

export async function classifyTaskAiLabels(taskId: number, projectId: number) {
  const labels = await prisma.label.findMany({
    where: { projectId, ai_prompt: { not: null } },
    select: { id: true, ai_prompt: true },
  });
  const definitions = labels
    .map(({ id, ai_prompt }) => ({ labelId: id, prompt: ai_prompt?.trim() ?? "" }))
    .filter(({ prompt }) => prompt.length > 0);
  if (definitions.length === 0) return;

  const task = await prisma.task.findFirst({
    where: { id: taskId, projectId, status: "Normal" },
    select: {
      id: true,
      title: true,
      description: true,
      userId: true,
      agentId: true,
      projectId: true,
      updatedAt: true,
      description_: { select: { content: true } },
      project: { select: { teamId: true } },
    },
  });
  if (!task?.updatedAt) return;

  await classifyTaskWithDefinitions({
    task,
    definitions,
    actor: await getAiActor(),
    snapshotAt: task.updatedAt,
  });
}

/**
 * HTPR-7098: queue the whole backfill as one half-price batch. Returns false (nothing queued) when
 * the flag is off, there is no team key, or the key is the team's own; the caller then runs the instant path.
 */
async function trySmartLabelBatch(
  userId: number | undefined,
  label: { id: string; prompt: string },
  tasks: Array<{
    id: number;
    title: string;
    description: string | null;
    projectId: number;
    updatedAt: Date | null;
    description_: { content: string } | null;
    project: { teamId: string | null };
  }>,
): Promise<boolean> {
  try {
    if (userId == null || !(await batchBackgroundAiEnabled(userId))) return false;
    const teamId = tasks[0]?.project.teamId;
    if (!teamId) return false;
    const gatewayKey = await getTeamGatewayApiKey({ trustedTeamId: teamId });
    if (!gatewayKey || !batchEligibleFunding(gatewayFundingSourceForApiKey(gatewayKey))) return false;
    const haikuDefaultEnabled = await haikuDefaultModelEnabled(userId);
    const model = gatewayCatalogModelSlug(haikuDefaultEnabled ? "anthropic/claude-haiku-5.5" : MODEL);
    if (!batchEligibleModel(model)) return false;
    await submitSmartLabelBatch({
      label,
      model,
      gatewayKey,
      teamId,
      usageUserId: haikuDefaultEnabled ? userId : generalConfig.hyperAiId,
      tasks: tasks.flatMap((task) =>
        task.updatedAt
          ? [{
              id: task.id,
              projectId: task.projectId,
              title: task.title,
              description: convertHtmlToText(task.description_?.content || task.description || ""),
              updatedAt: task.updatedAt,
            }]
          : [],
      ),
    });
    return true;
  } catch (error) {
    console.error("[labelClassifier] Batch submit failed; running the backfill now instead", error);
    return false;
  }
}

export async function backfillAiLabel(labelId: string, userId?: number) {
  const label = await prisma.label.findUnique({
    where: { id: labelId },
    select: { id: true, projectId: true, ai_prompt: true },
  });
  const prompt = label?.ai_prompt?.trim();
  if (!label?.projectId || !prompt) return;

  const tasks = await prisma.task.findMany({
    where: { projectId: label.projectId, status: "Normal" },
    take: BACKFILL_LIMIT,
    orderBy: { id: "asc" },
    select: {
      id: true,
      title: true,
      description: true,
      userId: true,
      agentId: true,
      projectId: true,
      updatedAt: true,
      description_: { select: { content: true } },
      project: { select: { teamId: true } },
    },
  });
  if (tasks.length === 0) return;
  if (await trySmartLabelBatch(userId, { id: label.id, prompt }, tasks)) return;
  const actor = await getAiActor();
  const definitions = [{ labelId: label.id, prompt }];
  let nextTaskIndex = 0;
  const worker = async () => {
    while (nextTaskIndex < tasks.length) {
      const task = tasks[nextTaskIndex++];
      try {
        if (!task.updatedAt) continue;
        await classifyTaskWithDefinitions({
          task,
          definitions,
          actor,
          snapshotAt: task.updatedAt,
        });
      } catch (error) {
        console.error(`Smart label backfill failed for task ${task.id}`, error);
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(BACKFILL_CONCURRENCY, tasks.length) },
      worker
    )
  );
}
