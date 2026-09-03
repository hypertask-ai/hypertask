import { generateObject, NoObjectGeneratedError } from "ai";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

import prisma from "@/lib/prisma";
import { scheduleJobById } from "@/lib/qstash";
import { getRedis } from "@/lib/redis";
import { logAiUsage } from "@/app/api/ai/_lib/aiUsage";
import { getTeamGatewayApiKey } from "@/app/api/ai/_lib/byokKeys";
import {
  convertHtmlToText,
  isSessionNoise,
} from "@/app/api/ai/_lib/taskContent";
import {
  providerOptionsForAiModel,
  resolveAiModel,
  type AiGatewayTags,
} from "@/app/api/ai/_lib/modelProvider";
import {
  resolveSystemModel,
  type SystemModel,
} from "@/app/api/ai/_lib/systemModelLadder";

const MAX_COMMENT_SOURCES = 200;
const SUMMARY_GENERATION_TIMEOUT_MS = 4 * 60 * 1000;
const SUMMARY_LOCK_TTL_SECONDS = 10 * 60;
const SUMMARY_PROMPT_VERSION = "task-summary-v2-one-call-2026-08-08";
const SUMMARY_FINGERPRINT_MARKER = "hypertask-summary-fingerprint";
const SUMMARY_RETRY_PATH = "/api/queues/FAST/generateSummaryQueue";

const summaryLockKey = (taskId: number) => `ai-summary:lock:${taskId}`;

type SummaryRedis = Awaited<ReturnType<typeof getRedis>>;
type SummaryLease = {
  redis: SummaryRedis;
  key: string;
  token: string;
};

export class SummaryRetryableError extends Error {
  cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = "SummaryRetryableError";
    this.cause = cause;
  }
}

export class SummaryRetrySchedulingError extends SummaryRetryableError {
  constructor(taskId: number, cause: unknown) {
    super(`Could not schedule a retry for busy task ${taskId} summary`, cause);
    this.name = "SummaryRetrySchedulingError";
  }
}

export class SummaryGenerationTimeoutError extends SummaryRetryableError {
  constructor(taskId: number, cause: unknown) {
    super(`Task ${taskId} summary generation timed out`, cause);
    this.name = "SummaryGenerationTimeoutError";
  }
}

export class SummaryConcurrencyUnavailableError extends SummaryRetryableError {
  constructor(taskId: number, cause: unknown) {
    super(`Summary concurrency guard is unavailable for task ${taskId}`, cause);
    this.name = "SummaryConcurrencyUnavailableError";
  }
}

const taskSummaryResultSchema = z.object({
  summary: z.string().describe("The task briefing in the required markdown format."),
  descriptionGoodEnough: z
    .boolean()
    .describe(
      "True only when the task description is detailed, current, actionable, and complements the comments."
    ),
});

type SummaryUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

type SummarySource = {
  index: number;
  creator: string;
  createdAt: string;
  text: string;
};

export async function generateAndStoreTaskSummary(
  taskId: number,
  options: { force?: boolean; agentId?: string | null } = {},
) {
  const lease = await acquireSummaryLease(taskId);
  if (lease === "busy") {
    await scheduleSummaryRetry(taskId, options.agentId);
    return null;
  }

  let releaseLease = true;
  try {
    return await generateAndStoreTaskSummaryWithLease(
      taskId,
      options,
    );
  } catch (error) {
    if (error instanceof SummaryGenerationTimeoutError) {
      releaseLease = false;
      console.error(
        `[taskSummaries] Retaining timed-out task ${taskId} lease until TTL expiry`,
      );
    }
    throw error;
  } finally {
    if (releaseLease) await releaseSummaryLease(lease);
  }
}

async function generateAndStoreTaskSummaryWithLease(
  taskId: number,
  options: { force?: boolean; agentId?: string | null },
) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      userId: true,
      agentId: true,
      projectId: true,
      title: true,
      ticketNumber: true,
      project: {
        select: {
          teamId: true,
          team: { select: { aiProviderSettings: true } },
        },
      },
      description_: { select: { content: true } },
      Task_Summary: {
        take: 1,
        select: { content: true },
      },
      comments: {
        orderBy: { createdAt: "desc" },
        take: MAX_COMMENT_SOURCES,
        select: {
          id: true,
          text: true,
          activity: true,
          createdAt: true,
          agentDisplayName: true,
          agent: { select: { displayName: true } },
          creator: { select: { displayName: true, email: true } },
        },
      },
    },
  });

  if (!task) return null;

  const description = convertHtmlToText(task.description_?.content ?? "");
  const systemModel = resolveSystemModel(
    "summaries",
    task.project.team?.aiProviderSettings,
  );
  if (!systemModel) return null;
  if (!task.project.teamId) {
    console.error(
      `[taskSummaries] Skipping task ${taskId}: task has no owning team`,
    );
    return null;
  }

  let gatewayApiKey: string | undefined;
  try {
    gatewayApiKey = await getTeamGatewayApiKey({
      trustedTeamId: task.project.teamId,
    });
  } catch (error) {
    console.error(
      `[taskSummaries] Skipping task ${taskId}: team gateway key lookup failed for ${task.project.teamId}`,
      error,
    );
    return null;
  }
  if (!gatewayApiKey) {
    console.error(
      `[taskSummaries] Skipping task ${taskId}: no dedicated gateway key for team ${task.project.teamId}`,
    );
    return null;
  }
  const gatewayTags: AiGatewayTags = {
    teamId: task.project.teamId,
    projectId: task.projectId,
  };
  const sources = task.comments
    .map((comment): Omit<SummarySource, "index"> | null => {
      const text = convertHtmlToText(
        comment.text || (comment.activity ? JSON.stringify(comment.activity) : "")
      );
      if (!text || isSessionNoise(text)) return null;
      return {
        creator:
          comment.agent?.displayName ||
          comment.agentDisplayName ||
          comment.creator?.displayName ||
          comment.creator?.email ||
          (comment.activity ? "Activity Log" : "Unknown"),
        createdAt: comment.createdAt.toISOString(),
        text,
      };
    })
    .filter(
      (source): source is Omit<SummarySource, "index"> => source !== null,
    )
    .map((source, index): SummarySource => ({
      index: index + 1,
      ...source,
    }));

  const fingerprint = createSummaryFingerprint({
    teamId: task.project.teamId,
    title: task.title,
    ticketNumber: task.ticketNumber ?? "",
    description,
    sources,
    systemModel,
  });
  if (!options.force) {
    const storedSummary = task.Task_Summary[0]?.content?.trim();
    if (
      storedSummary &&
      extractSummaryFingerprint(storedSummary) === fingerprint
    ) {
      return stripSummaryFingerprint(storedSummary);
    }
  }

  const abortSignal = AbortSignal.timeout(SUMMARY_GENERATION_TIMEOUT_MS);
  let generated;
  try {
    generated = await generateTaskSummary({
      title: task.title,
      ticketNumber: task.ticketNumber ?? "",
      description,
      sources,
      systemModel,
      gatewayApiKey,
      gatewayTags,
      userId: task.userId,
      teamId: task.project.teamId,
      projectId: task.projectId,
      taskId: task.id,
      // Explicit null means a human triggered the debounced job. Only direct
      // legacy callers that omit the actor fall back to the task creator.
      agentId: options.agentId === undefined ? task.agentId : options.agentId,
      abortSignal,
    });
  } catch (error) {
    if (isAbortError(error) || abortSignal.aborted) {
      throw new SummaryGenerationTimeoutError(taskId, error);
    }
    throw error;
  }
  if (!generated) {
    console.error(
      `[taskSummaries] Keeping the existing summary for task ${taskId}: no valid summary could be recovered`,
    );
    return null;
  }

  const persistedSummary = appendSummaryFingerprint(
    generated.summary,
    fingerprint,
  );
  await prisma.$transaction([
    prisma.task_Summary.upsert({
      where: { taskId },
      create: {
        taskId,
        content: persistedSummary,
        updatedAt: new Date(),
      },
      update: {
        content: persistedSummary,
        updatedAt: new Date(),
      },
    }),
    prisma.description.updateMany({
      where: { taskId },
      data: { flaggedIncomplete: generated.descriptionGoodEnough },
    }),
  ]);

  return generated.summary;
}

async function acquireSummaryLease(
  taskId: number,
): Promise<SummaryLease | "busy"> {
  const key = summaryLockKey(taskId);
  const token = randomUUID();

  try {
    const redis = await getRedis();
    const acquired = await redis.set(
      key,
      token,
      "EX",
      SUMMARY_LOCK_TTL_SECONDS,
      "NX",
    );
    if (acquired !== "OK") {
      console.log(
        `[taskSummaries] Skipping duplicate generation for task ${taskId}: another worker holds the lease`,
      );
      return "busy";
    }
    return { redis, key, token };
  } catch (error) {
    console.error(
      `[taskSummaries] Deferring task ${taskId}: summary deduplication is unavailable`,
      error,
    );
    throw new SummaryConcurrencyUnavailableError(taskId, error);
  }
}

async function scheduleSummaryRetry(taskId: number, agentId?: string | null) {
  const delaySeconds = 45 + Math.floor(Math.random() * 30);
  try {
    const scheduled = await scheduleJobById({
      jobId: `ai-summary-retry-for-taskId:${taskId}`,
      path: SUMMARY_RETRY_PATH,
      // Preserve omitted versus explicit null across retries. Omitted allows
      // the worker to recover the legacy task-agent attribution fallback.
      body: agentId === undefined ? { taskId } : { taskId, agentId },
      notBefore: Math.floor(Date.now() / 1000) + delaySeconds,
    });
    if (!scheduled) {
      throw new Error("Task summary retry scheduling lock is busy");
    }
  } catch (error) {
    throw new SummaryRetrySchedulingError(taskId, error);
  }
}

function isAbortError(error: unknown) {
  if (!error || typeof error !== "object" || !("name" in error)) return false;
  return error.name === "AbortError" || error.name === "TimeoutError";
}

async function releaseSummaryLease(lease: SummaryLease) {
  try {
    await lease.redis.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then
         return redis.call("del", KEYS[1])
       end
       return 0`,
      1,
      lease.key,
      lease.token,
    );
  } catch (error) {
    console.error(
      `[taskSummaries] Summary lease ${lease.key} will expire automatically`,
      error,
    );
  }
}

function createSummaryFingerprint(args: {
  teamId: string;
  title: string;
  ticketNumber: string;
  description: string;
  sources: SummarySource[];
  systemModel: SystemModel;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        promptVersion: SUMMARY_PROMPT_VERSION,
        teamId: args.teamId,
        title: args.title,
        ticketNumber: args.ticketNumber,
        description: args.description,
        sources: args.sources,
        provider: args.systemModel.provider,
        model: args.systemModel.model,
      }),
    )
    .digest("hex");
}

function appendSummaryFingerprint(summary: string, fingerprint: string) {
  return `${stripSummaryFingerprint(summary)}\n\n[${SUMMARY_FINGERPRINT_MARKER}]: # (${fingerprint})`;
}

function extractSummaryFingerprint(summary: string) {
  const match = summary.match(
    new RegExp(
      `(?:^|\\n)\\[${SUMMARY_FINGERPRINT_MARKER}\\]: # \\(([a-f0-9]{64})\\)\\s*$`,
    ),
  );
  return match?.[1] ?? null;
}

function stripSummaryFingerprint(summary: string) {
  return summary
    .replace(
      new RegExp(
        `\\n*\\[${SUMMARY_FINGERPRINT_MARKER}\\]: # \\([a-f0-9]{64}\\)\\s*$`,
      ),
      "",
    )
    .trim();
}

async function generateTaskSummary(args: {
  title: string;
  ticketNumber: string;
  description: string;
  sources: SummarySource[];
  systemModel: SystemModel;
  gatewayApiKey?: string;
  gatewayTags?: AiGatewayTags;
  userId: number;
  teamId?: string | null;
  projectId?: number | null;
  taskId: number;
  agentId?: string | null;
  abortSignal?: AbortSignal;
}) {
  if (!args.description && args.sources.length === 0) {
    return {
      summary: "Not enough content for summary",
      descriptionGoodEnough: false,
    };
  }

  const model = resolveAiModel(
    "gateway",
    args.systemModel.model,
    args.gatewayApiKey
  );
  try {
    const result = await generateObject({
      model,
      schema: taskSummaryResultSchema,
      system: `Return both the task briefing and the description-quality verdict from this one request.

Write the summary as a scannable briefing for two readers at once: someone opening the task for the first time, and someone catching up after time away. Apply BLUF (bottom line up front) and the pyramid principle to EACH section independently: the single most important point comes first, supporting detail follows.

The summary field must contain EXACTLY these two markdown sections, nothing before or after:

## What this is
- 2-3 bullets about the TASK ITSELF, not who did what. First bullet = the core goal or hypothesis in one line so a newcomer instantly gets it. Then the key constraint or decision, and the current status.

## Recent activity
- 3-5 bullets, ordered by IMPORTANCE first and recency second. Never pure chronology.

HARD RULES:
- Every bullet is ONE short line, max ~12 words, telegraphic. A summary, not a retelling.
- NO filler openings. Never write "This task aims to", "This ticket is about", "The goal is". Start with the substance.
- Amplify real human decisions, approvals, objections, and scope changes. Put them at the top of Recent activity.
- Agent/bot @mention pings, re-pings, and bot-to-bot coordination: include only if nothing more important happened, and compress to ONE short line. Never a bullet each.
- Attribute actions to the person by name. No invented task or project IDs. No citations, footnotes, or bracketed numbers.
- Use "- " markdown bullets and the two "## " headers exactly as shown.

Set descriptionGoodEnough to true only when the task description is sufficiently detailed, current, actionable, and complements the comments. Set it to false when the description is empty, too thin, outdated, redundant, or not actionable.`,
      prompt: `Task title: ${args.title}
Ticket: ${args.ticketNumber}

Task description:
${args.description || "(empty)"}

SOURCE DATA:
${formatSources(args.sources)}

Summary:`,
      maxRetries: 2,
      maxOutputTokens: 700,
      abortSignal: args.abortSignal,
      providerOptions: providerOptionsForAiModel(
        model,
        "summary",
        args.gatewayTags
      ),
    });

    await logSummaryUsage(args, result.usage);

    return {
      summary: result.object.summary.trim() || "Not enough content for summary",
      descriptionGoodEnough:
        Boolean(args.description) && result.object.descriptionGoodEnough,
    };
  } catch (error) {
    if (!NoObjectGeneratedError.isInstance(error)) throw error;

    await logSummaryUsage(args, error.usage);
    const recoveredSummary = recoverSummaryText(error.text);
    if (!recoveredSummary) return null;

    console.error(
      "[taskSummaries] Structured verdict was invalid; persisting the recovered summary with a conservative description verdict",
      error.cause,
    );
    return {
      summary: recoveredSummary,
      descriptionGoodEnough: false,
    };
  }
}

async function logSummaryUsage(
  args: {
    userId: number;
    teamId?: string | null;
    projectId?: number | null;
    taskId: number;
    agentId?: string | null;
    systemModel: SystemModel;
  },
  usage?: SummaryUsage,
) {
  await logAiUsage({
    userId: args.userId,
    teamId: args.teamId,
    projectId: args.projectId,
    taskId: args.taskId,
    agentId: args.agentId,
    provider: args.systemModel.provider,
    model: args.systemModel.model,
    feature: "summary",
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
  });
}

function recoverSummaryText(text?: string) {
  if (!text?.trim()) return null;

  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    const parsed = JSON.parse(unfenced) as { summary?: unknown };
    if (typeof parsed.summary === "string" && parsed.summary.trim()) {
      return completeRecoveredSummary(parsed.summary);
    }
  } catch {
    // Some providers return the usable markdown even when structured parsing fails.
  }

  const summaryStart = unfenced.indexOf("## What this is");
  return summaryStart >= 0
    ? completeRecoveredSummary(unfenced.slice(summaryStart))
    : null;
}

function completeRecoveredSummary(value: string) {
  const summary = value.trim();
  const whatHeader = "## What this is";
  const recentHeader = "## Recent activity";
  const whatStart = summary.indexOf(whatHeader);
  const recentStart = summary.indexOf(recentHeader);
  if (whatStart !== 0 || recentStart <= whatHeader.length) return null;

  const whatBody = summary.slice(whatHeader.length, recentStart);
  const recentBody = summary.slice(recentStart + recentHeader.length);
  if (!/(?:^|\n)- \S/.test(whatBody) || !/(?:^|\n)- \S/.test(recentBody)) {
    return null;
  }
  return summary;
}

function formatSources(sources: SummarySource[]) {
  if (sources.length === 0) return "(no comments)";
  return sources
    .map(
      (source) =>
        `[${source.index}] comment_creator: ${source.creator}\ncreated_at: ${source.createdAt}\ntext: ${source.text}`
    )
    .join("\n\n");
}
