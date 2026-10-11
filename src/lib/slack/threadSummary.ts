import { resolveAiModel as resolveLegacyAiModel } from "@/app/api/ai/_lib/modelProvider";
import { getAiDefaultModelContext, resolveAutomaticAiModel } from "@/app/api/ai/_lib/byokKeys";
import { configureAiModelUsage } from "@/app/api/ai/_lib/modelProvider";
import { generateObject } from "ai";

import { getTeamGatewayApiKey } from "@/app/api/ai/_lib/byokKeys";
import {
  providerOptionsForAiModel,
  aiUsageProviderForCredential,
} from "@/app/api/ai/_lib/modelProvider";
import { resolveSystemModel } from "@/lib/systemModelLadder";
import { callSlackApi } from "@/lib/slack/api";
import {
  renderSlackSummaryComment,
  SLACK_SUMMARY_MAX_OUTPUT_TOKENS,
  SLACK_SUMMARY_SYSTEM,
  slackSummaryPrompt,
  slackSummarySchema,
} from "@/lib/slack/threadSummaryPrompt";

export type SlackThreadMessage = {
  bot_id?: string;
  subtype?: string;
  text?: string;
  ts?: string;
  user?: string;
};

type SlackRepliesResponse = {
  error?: string;
  has_more?: boolean;
  messages?: SlackThreadMessage[];
  ok: boolean;
  response_metadata?: { next_cursor?: string };
};

type SlackUserResponse = {
  error?: string;
  ok: boolean;
  user?: {
    name?: string;
    profile?: { display_name?: string; real_name?: string };
    real_name?: string;
  };
};

type SlackPermalinkResponse = {
  error?: string;
  ok: boolean;
  permalink?: string;
};

export const MAX_SLACK_THREAD_PAGES = 5;
export const MAX_SLACK_TRANSCRIPT_CHARACTERS = 16_000;
export const SLACK_TRANSCRIPT_TRUNCATION_NOTICE =
  "[Earlier Slack messages were truncated; only the most recent part of the thread is shown.]";

export type SlackThreadSummaryContext = {
  aiProviderSettings: unknown;
  botToken: string;
  channelId: string;
  installedByUserId: number;
  projectId: number | null;
  taskId?: number | null;
  teamId: string;
  threadTs: string;
  userNameCache: Map<string, Promise<string>>;
};

export type SlackThreadSource = {
  lastMessageTs: string;
  participants: string[];
  permalink: string;
  transcript: string;
};

/**
 * Which model and key a thread summary runs on. HTPR-7098 reads this too, to decide whether the
 * thread can wait in a half-price batch (`haikuByok` set means the team's own key: instant path only).
 */
export async function resolveSlackSummaryModelInputs(
  context: Pick<SlackThreadSummaryContext, "aiProviderSettings" | "teamId" | "installedByUserId">,
) {
  const defaultContext = typeof getAiDefaultModelContext === "function" ? await getAiDefaultModelContext({ trustedTeamId: context.teamId, userId: context.installedByUserId }) : { haiku55Enabled: false, byok: undefined };
  const systemModel = resolveSystemModel(
    "summaries",
    context.aiProviderSettings,
    defaultContext.haiku55Enabled, defaultContext,
  );
  if (!systemModel) return null;
  const gatewayApiKey = await getTeamGatewayApiKey({ trustedTeamId: context.teamId });
  const haikuByok = systemModel.model === "anthropic/claude-haiku-5.5" ? defaultContext.byok : undefined;
  return { defaultContext, systemModel, gatewayApiKey, haikuByok };
}

export async function buildSlackThreadSummaryComment(
  context: SlackThreadSummaryContext & { source?: SlackThreadSource },
): Promise<string | null> {
  const source = context.source ?? (await loadSlackThreadSource(context));
  const { participants, permalink, transcript } = source;
  if (!transcript) return null;

  const inputs = await resolveSlackSummaryModelInputs(context);
  if (!inputs) return null;
  const { defaultContext, systemModel, gatewayApiKey, haikuByok } = inputs;
  const model = defaultContext.haiku55Enabled ? resolveAutomaticAiModel(haikuByok?.provider === "claude" ? "claude" : haikuByok?.provider === "openrouter" ? "openrouter" : "gateway", haikuByok?.provider === "claude" ? "claude-haiku-5-5" : systemModel.model, haikuByok?.credential ?? gatewayApiKey, { haiku55Enabled: defaultContext.haiku55Enabled, lookup: { trustedTeamId: context.teamId, projectId: context.projectId, userId: context.installedByUserId }, feature: "summary" }) : resolveLegacyAiModel("gateway", systemModel.model, gatewayApiKey);
  configureAiModelUsage(model, {
    userId: context.installedByUserId,
    teamId: context.teamId,
    projectId: context.projectId,
    taskId: context.taskId,
    provider: haikuByok ? aiUsageProviderForCredential(haikuByok.provider, haikuByok.credential) : systemModel.provider,
    feature: "summary",
  });
  const result = await generateObject({
    model,
    schema: slackSummarySchema,
    maxRetries: 2,
    maxOutputTokens: SLACK_SUMMARY_MAX_OUTPUT_TOKENS,
    providerOptions: providerOptionsForAiModel(model, "summary", {
      teamId: context.teamId,
      projectId: context.projectId,
      userId: context.installedByUserId,
    }),
    system: SLACK_SUMMARY_SYSTEM,
    prompt: slackSummaryPrompt(transcript),
  });

  return renderSlackSummaryComment(result.object, participants, permalink);
}

export async function loadSlackThreadSource(
  context: Pick<
    SlackThreadSummaryContext,
    "botToken" | "channelId" | "teamId" | "threadTs" | "userNameCache"
  >,
  options: { includeBots?: boolean } = {},
): Promise<SlackThreadSource> {
  const messages = await fetchFullSlackThread(context);
  const transcriptMessages = selectRecentTranscriptMessages(
    messages.filter(
      (message) =>
        message.text?.trim() && (options.includeBots || !message.bot_id),
    ),
  );
  const participantIds = [
    ...new Set(
      transcriptMessages.flatMap((message) =>
        message.user ? [message.user] : [],
      ),
    ),
  ];
  const participants = await Promise.all(
    participantIds.map((userId) => resolveSlackUserName(context, userId)),
  );
  const namesById = new Map(
    participantIds.map((userId, index) => [userId, participants[index]]),
  );
  const fullTranscript = transcriptMessages
    .map((message) => {
      const author = message.user
        ? namesById.get(message.user) ?? message.user
        : message.bot_id
          ? "Slack bot"
          : "Unknown participant";
      return `[${message.ts ?? "unknown time"}] ${author}: ${message.text}`;
    })
    .join("\n");
  const transcript = truncateSlackTranscript(fullTranscript);
  const permalink = await getSlackThreadPermalink(context);
  const lastMessageTs = messages.reduce(
    (latest, message) =>
      message.ts && Number(message.ts) > Number(latest) ? message.ts : latest,
    context.threadTs,
  );

  return { lastMessageTs, participants, permalink, transcript };
}

async function fetchFullSlackThread(
  context: Pick<
    SlackThreadSummaryContext,
    "botToken" | "channelId" | "threadTs"
  >,
): Promise<SlackThreadMessage[]> {
  const messages: SlackThreadMessage[] = [];
  let cursor = "";

  for (let page = 0; page < MAX_SLACK_THREAD_PAGES; page += 1) {
    const result = await callSlackApi<SlackRepliesResponse>(
      "conversations.replies",
      context.botToken,
      {
        channel: context.channelId,
        ts: context.threadTs,
        limit: "200",
        ...(cursor ? { cursor } : {}),
      },
    );
    messages.push(...(result.messages ?? []));
    cursor = result.response_metadata?.next_cursor?.trim() ?? "";
    if (!cursor) break;
  }

  return messages;
}

export function truncateSlackTranscript(transcript: string): string {
  if (transcript.length <= MAX_SLACK_TRANSCRIPT_CHARACTERS) return transcript;

  const availableCharacters =
    MAX_SLACK_TRANSCRIPT_CHARACTERS -
    SLACK_TRANSCRIPT_TRUNCATION_NOTICE.length -
    1;
  return (
    `${SLACK_TRANSCRIPT_TRUNCATION_NOTICE}\n` +
    transcript.slice(-availableCharacters)
  );
}

function selectRecentTranscriptMessages(
  messages: SlackThreadMessage[],
): SlackThreadMessage[] {
  let estimatedCharacters = 0;
  let firstIncludedIndex = messages.length;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    // Reserve room for the timestamp, author name, separators, and newline.
    estimatedCharacters += (message.text?.length ?? 0) + 128;
    firstIncludedIndex = index;
    if (estimatedCharacters >= MAX_SLACK_TRANSCRIPT_CHARACTERS) break;
  }

  return messages.slice(firstIncludedIndex);
}

function resolveSlackUserName(
  context: Pick<
    SlackThreadSummaryContext,
    "botToken" | "teamId" | "userNameCache"
  >,
  userId: string,
): Promise<string> {
  const cacheKey = `${context.teamId}:${userId}`;
  const cached = context.userNameCache.get(cacheKey);
  if (cached) return cached;

  const pending = callSlackApi<SlackUserResponse>("users.info", context.botToken, {
    user: userId,
  })
    .then(
      (result) =>
        result.user?.profile?.display_name?.trim() ||
        result.user?.profile?.real_name?.trim() ||
        result.user?.real_name?.trim() ||
        result.user?.name?.trim() ||
        userId,
    )
    .catch((error) => {
      console.warn(`Slack users.info failed for ${userId}`, error);
      return userId;
    });
  context.userNameCache.set(cacheKey, pending);
  return pending;
}

async function getSlackThreadPermalink(
  context: Pick<
    SlackThreadSummaryContext,
    "botToken" | "channelId" | "threadTs"
  >,
): Promise<string> {
  const result = await callSlackApi<SlackPermalinkResponse>(
    "chat.getPermalink",
    context.botToken,
    { channel: context.channelId, message_ts: context.threadTs },
  );
  if (!result.permalink) throw new Error("Slack did not return a thread permalink");
  return result.permalink;
}
