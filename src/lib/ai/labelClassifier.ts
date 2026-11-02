import { findSharedAiAllowanceError } from "@/app/api/ai/_lib/allowanceError";
import { isFeatureEnabled } from "@/lib/flags";
import { YPER4_915_ERROR_LOG_NEVER_BUG_FLAG } from "@/lib/flags/definitions/yper4-915-error-log-never-bug";
import { HTPR_8099_SMART_LABEL_REFUSAL_FLAG } from "@/lib/flags/definitions/htpr-8099-smart-label-refusal";
import { teamPlanAllowanceEnabled } from "@/app/api/ai/_lib/planAllowancePolicy";
import { downloadWithoutBrotli } from "@/lib/net/downloadWithoutBrotli";
import { configureAiModelUsage } from "@/app/api/ai/_lib/modelProvider";
import { waitUntil } from "@vercel/functions";
import { generateText } from "ai";

import { getTeamGatewayApiKey, resolveAutomaticAiModel } from "@/app/api/ai/_lib/byokKeys";
import { batchBackgroundAiEnabled } from "@/app/api/ai/_lib/planGate";
import { resolveTeamAiFunding } from "@/lib/ai/teamAiFunding";
import { gatewayCatalogModelSlug } from "@/app/api/ai/_lib/sharedAllowance";
import { batchEligibleFunding, batchEligibleModel, labelTaskContentHash } from "@/lib/ai/batch/batchJobs";
import { submitSmartLabelBatch } from "@/lib/ai/labelClassifierBatch";
import {
  gatewayFundingSourceForApiKey,
  gatewayProviderOptionsForModel,
  resolveAiModel,
} from "@/app/api/ai/_lib/modelProvider";
import { convertHtmlToText } from "@/app/api/ai/_lib/taskContent";
import { generalConfig } from "@/lib/configs/general.config";
import {
  LABEL_CLASSIFIER_INSTRUCTIONS,
  LABEL_CLASSIFIER_MAX_OUTPUT_TOKENS,
  labelClassifierPrompt,
  parseMatchingLabelIds,
  withholdBugFromErrorLog,
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

  const keyOnly = typeof resolveTeamAiFunding === "function"
    ? await resolveTeamAiFunding(tags.teamId, { provider: "anthropic", feature: "labels" })
    : { mode: "unrestricted" as const };
  if (keyOnly.mode === "refused") {
    console.error(`[labelClassifier] ${keyOnly.message}`);
    return null;
  }
  let gatewayApiKey: string | undefined;
  if (keyOnly.mode === "byok" && keyOnly.provider === "gateway") {
    gatewayApiKey = keyOnly.apiKey;
  } else if (keyOnly.mode === "unrestricted") {
    try {
      gatewayApiKey = await getTeamGatewayApiKey({ trustedTeamId: tags.teamId });
    } catch (error) {
      if (findSharedAiAllowanceError(error) && await isFeatureEnabled(HTPR_8099_SMART_LABEL_REFUSAL_FLAG, tags.userId ?? 0).catch(() => false)) return null;
      console.error(`[labelClassifier] Skipping inference: team gateway key lookup failed for ${tags.teamId}`, error);
      return null;
    }
    if (!gatewayApiKey) {
      console.error(`[labelClassifier] Skipping inference: no dedicated gateway key for team ${tags.teamId}`);
      return null;
    }
  }
  const fundedModel = keyOnly.mode === "byok" && keyOnly.provider !== "gateway"
    ? resolveAiModel("claude", "claude-haiku-4-5", keyOnly.apiKey)
    : undefined;
  const model = fundedModel ?? resolveAutomaticAiModel("gateway", "anthropic/claude-haiku-5.5", gatewayApiKey, {
    haiku55Enabled: true,
    lookup: { trustedTeamId: tags.teamId, projectId: tags.projectId, userId: tags.userId ?? 0 },
    feature: "smart-label",
  });
  configureAiModelUsage(model, {
    userId: tags?.userId ?? 0,
    teamId: tags?.teamId,
    projectId: tags?.projectId,
    taskId: tags?.taskId,
    agentId: tags?.agentId,
    provider: fundedModel ? "byok:claude" : "anthropic",
    feature: "smart-label",
    reasoningFeature: "labels",
  });
  let result;
  try {
    result = await generateText({
      experimental_download: downloadWithoutBrotli,
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
  } catch (error) {
    if (findSharedAiAllowanceError(error) && await isFeatureEnabled(HTPR_8099_SMART_LABEL_REFUSAL_FLAG, tags.userId ?? 0).catch(() => false)) {
      return null;
    }
    throw error;
  }

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
  contentHash?: string;
}) {
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
    select: { id: true, ai_prompt: true, value: true },
  });
  const currentPrompts = new Map(
    currentLabels.map(({ id, ai_prompt }) => [id, ai_prompt?.trim()])
  );
  const activeDefinitions = definitions.filter(
    ({ labelId, prompt }) => currentPrompts.get(labelId) === prompt
  );
  if (activeDefinitions.length === 0) return;

  const aiLabelIds = activeDefinitions.map(({ labelId }) => labelId);
  const errorLogGuardEnabled = await isFeatureEnabled(YPER4_915_ERROR_LOG_NEVER_BUG_FLAG, actor.id).catch(() => true);
  const matchingIds = new Set(matchingLabelIds);
  const result = await prisma.$transaction(async (tx) => {
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
    const toRemove = existing.filter(({ labelId }) => !matchingIds.has(labelId));
    const removedIds = new Set(toRemove.map(({ labelId }) => labelId));
    const matchedToAdd = aiLabelIds.filter(
      (labelId) => matchingIds.has(labelId) && !existingIds.has(labelId)
    );
    const toAdd = errorLogGuardEnabled
      ? withholdBugFromErrorLog(
          matchedToAdd,
          new Map(currentLabels.map(({ id, value }) => [id, value])),
          labelsBefore
            .filter(({ labelId }) => !removedIds.has(labelId))
            .map(({ label }) => label.value),
        )
      : matchedToAdd;

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
      console.warn("[labelClassifier] agent task.updated queue publish failed; outbox sweep will retry", error);
    }
    void broadcastBoardChange(projectId, { originUserId: actor.id });
  }
}

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

export async function classifyNewTaskAiLabels(taskId: number, projectId: number) {
  const labelsPickedByCreator = await prisma.taskLabel.findMany({
    where: { taskId },
    select: { labelId: true },
  });
  await classifyTaskAiLabels(
    taskId,
    projectId,
    new Set(labelsPickedByCreator.map(({ labelId }) => labelId)),
  );
}

export function scheduleClassifyTaskAiLabels(taskId: number, projectId: number) {
  waitUntil(classifyTaskAiLabels(taskId, projectId).catch(console.error));
}

export function scheduleClassifyNewTaskAiLabels(taskId: number, projectId: number) {
  waitUntil(classifyNewTaskAiLabels(taskId, projectId).catch(console.error));
}

export function scheduleBackfillAiLabel(labelId: string, userId?: number) {
  waitUntil(backfillAiLabel(labelId, userId).catch(console.error));
}

export async function classifyTaskAiLabels(
  taskId: number,
  projectId: number,
  labelIdsLeftToCreator: ReadonlySet<string> = new Set(),
) {
  const labels = await prisma.label.findMany({
    where: { projectId, ai_prompt: { not: null } },
    select: { id: true, ai_prompt: true },
  });
  const definitions = labels
    .map(({ id, ai_prompt }) => ({ labelId: id, prompt: ai_prompt?.trim() ?? "" }))
    .filter(({ labelId, prompt }) => prompt.length > 0 && !labelIdsLeftToCreator.has(labelId));
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
    if (!gatewayKey || !batchEligibleFunding(gatewayFundingSourceForApiKey(gatewayKey), await teamPlanAllowanceEnabled(teamId))) return false;
    const model = gatewayCatalogModelSlug("anthropic/claude-haiku-5.5");
    if (!batchEligibleModel(model)) return false;
    await submitSmartLabelBatch({
      label,
      model,
      gatewayKey,
      teamId,
      usageUserId: userId,
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
