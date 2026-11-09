import { generateText, Output } from "ai";
import { z } from "zod";

import type { AiGatewayTags } from "@/app/api/ai/_lib/modelProvider";
import { renderPrompt } from "@/lib/ai/prompts/registry";
import prisma from "@/lib/prisma";
import { downloadWithoutBrotli } from "@/lib/net/downloadWithoutBrotli";
import {
  SKILL_OFFER_MAX_SESSIONS,
  SKILL_OFFER_MAX_SOURCES,
  SKILL_OFFER_MIN_OCCURRENCES,
  SKILL_OFFER_MIN_SESSIONS,
  SKILL_OFFER_WINDOW_DAYS,
  verifySkillOfferPattern,
  type ChatInstructionSource,
  type SkillOfferPattern,
  type VerifiedSkillOffer,
} from "./contract";

const SKILL_OFFER_MODEL = "gpt-6-luna";
const SKILL_OFFER_MAX_MESSAGE_LENGTH = 700;

const patternSchema = z.object({
  patterns: z.array(z.object({
    key: z.string().optional(),
    rule: z.string(),
    kind: z.enum(["skill", "memory"]),
    quotes: z.array(z.object({ message_id: z.string(), quote: z.string() })).max(8),
    draft: z.object({
      slug: z.string().optional(),
      name: z.string().optional(),
      description: z.string().nullable().optional(),
      argument_hint: z.string().nullable().optional(),
      body: z.string().optional(),
    }).optional(),
  })).max(3),
});

export async function loadInstructionSources(
  userId: number,
  projectId: number,
): Promise<ChatInstructionSource[]> {
  const since = new Date(Date.now() - SKILL_OFFER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const sessions = await prisma.chatSession.findMany({
    where: { userId, agentId: null, updatedAt: { gte: since } },
    select: { id: true, projectId: true, taskId: true },
    orderBy: { updatedAt: "desc" },
    take: SKILL_OFFER_MAX_SESSIONS,
  });
  const taskIds = sessions.map((session) => session.taskId)
    .filter((taskId): taskId is number => typeof taskId === "number");
  const tasks = taskIds.length
    ? await prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, projectId: true } })
    : [];
  const taskBoard = new Map(tasks.map((task) => [task.id, task.projectId]));
  const sessionIds = sessions.filter((session) =>
    session.projectId === projectId ||
    (session.taskId != null && taskBoard.get(session.taskId) === projectId),
  ).map((session) => session.id);
  if (!sessionIds.length) return [];

  const rows = await prisma.chatMessage.findMany({
    where: { role: "human", authorUserId: userId, createdAt: { gte: since }, sessionId: { in: sessionIds } },
    select: { id: true, sessionId: true, content: true },
    orderBy: { createdAt: "desc" },
    take: SKILL_OFFER_MAX_SOURCES,
  });
  return rows.map((row) => ({ messageId: row.id, sessionId: row.sessionId, content: row.content.trim() }))
    .filter((row) => row.content.length > 0);
}

export async function detectRepeatedInstruction(args: {
  userId: number;
  projectId: number;
  teamId: string | null;
  sources: ChatInstructionSource[];
}): Promise<VerifiedSkillOffer | null> {
  if (args.sources.length < SKILL_OFFER_MIN_OCCURRENCES) return null;

  const { getByokOrTeamGatewayApiKeyForProvider } = await import("@/app/api/ai/_lib/byokKeys");
  const provider = await import("@/app/api/ai/_lib/modelProvider");
  const gatewayApiKey = await getByokOrTeamGatewayApiKeyForProvider("openai", undefined, {
    projectId: args.projectId,
    userId: args.userId,
  });
  const model = provider.resolveAiModel("openai", SKILL_OFFER_MODEL, gatewayApiKey);
  const gatewayTags: AiGatewayTags = { projectId: args.projectId, teamId: args.teamId ?? "", userId: args.userId };
  provider.configureAiModelUsage(model, {
    userId: args.userId,
    teamId: args.teamId,
    projectId: args.projectId,
    provider: provider.aiUsageProviderForCredential("openai", gatewayApiKey),
    feature: "chat",
  });

  const result = await generateText({
    experimental_download: downloadWithoutBrotli,
    model,
    output: Output.object({ schema: patternSchema }),
    maxRetries: 1,
    maxOutputTokens: 900,
    providerOptions: provider.gatewayProviderOptionsForModel(model, "chat", gatewayTags),
    system: renderPrompt("skill-offer-system-1", SKILL_OFFER_MIN_OCCURRENCES, SKILL_OFFER_MIN_SESSIONS),
    prompt: JSON.stringify({
      messages: args.sources.map((source) => ({
        id: source.messageId,
        session: source.sessionId,
        text: source.content.slice(0, SKILL_OFFER_MAX_MESSAGE_LENGTH),
      })),
    }),
  });

  return result.output.patterns
    .map((pattern) => verifySkillOfferPattern(toPattern(pattern), args.sources))
    .filter((offer): offer is VerifiedSkillOffer => offer !== null)
    .sort((left, right) => right.occurrences - left.occurrences)[0] ?? null;
}

function toPattern(pattern: z.infer<typeof patternSchema>["patterns"][number]): SkillOfferPattern {
  const draft = pattern.draft;
  return {
    key: pattern.key,
    rule: pattern.rule,
    kind: pattern.kind,
    quotes: pattern.quotes.map((quote) => ({ messageId: quote.message_id, quote: quote.quote })),
    draft: draft
      ? {
          slug: draft.slug ?? "",
          name: draft.name ?? "",
          description: draft.description ?? null,
          argumentHint: draft.argument_hint ?? null,
          body: draft.body ?? "",
        }
      : undefined,
  };
}
