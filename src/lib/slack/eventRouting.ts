import { hasSlackCreateTaskIntent } from "@/lib/slack/taskCreateIntent";

export type SlackEvent = {
  assistant_thread?: {
    channel_id?: string;
    thread_ts?: string;
    user_id?: string;
    context?: { channel_id?: string; team_id?: string; enterprise_id?: string };
  };
  // tokens_revoked payload fields (HTPR-4857): Slack sends user IDs, split
  // by OAuth kind.
  event_ts?: string;
  tokens?: {
    oauth?: string[];
    bot?: string[];
  };
  bot_id?: string;
  channel?: string;
  channel_type?: string;
  subtype?: string;
  text?: string;
  thread_ts?: string;
  ts?: string;
  type?: string;
  user?: string;
};

export type SlackEventRoute =
  | "assistant_welcome"
  | "assistant_context"
  | "create_task"
  | "general_chat"
  | "ambient_message"
  | "ignore";

const HUMAN_MESSAGE_SUBTYPES = new Set([
  undefined,
  "file_share",
  "me_message",
  "thread_broadcast",
]);

export function routeSlackEvent(
  event: SlackEvent | undefined,
  slackAppEnabled = false,
): SlackEventRoute {
  if (
    slackAppEnabled &&
    event?.type === "assistant_thread_context_changed" &&
    event.assistant_thread?.channel_id &&
    event.assistant_thread.thread_ts &&
    event.assistant_thread.user_id
  ) {
    return "assistant_context";
  }
  if (
    isCreateTaskMention(event) &&
    (!slackAppEnabled || /\b(?:from|for|of)\s+(?:this|the)\s+(?:thread|discussion|conversation)\b|\b(?:this|the)\s+(?:thread|discussion|conversation)\s+as\s+a\s+(?:task|ticket)\b/i.test(event.text))
  ) return "create_task";
  if (isGeneralChatEvent(event)) return "general_chat";
  if (
    event?.type === "assistant_thread_started" &&
    event.assistant_thread?.channel_id &&
    event.assistant_thread.thread_ts
  ) {
    return "assistant_welcome";
  }
  if (isHumanChannelMessage(event)) return "ambient_message";
  return "ignore";
}

export function extractSlackMentionText(text: string, botUserId?: string): string {
  return botUserId
    ? text.split(`<@${botUserId}>`).join("").trim()
    : text.replace(/<@[A-Z0-9]+>/gi, "").trim();
}

export function isCreateTaskMention(
  event: SlackEvent | undefined,
): event is SlackEvent & {
  channel: string;
  text: string;
  ts: string;
  user: string;
} {
  return Boolean(
    event?.type === "app_mention" &&
      event.channel &&
      event.ts &&
      event.user &&
      !event.bot_id &&
      event.text &&
      hasSlackCreateTaskIntent(event.text),
  );
}

export function isGeneralChatEvent(
  event: SlackEvent | undefined,
): event is SlackEvent & {
  channel: string;
  text: string;
  ts: string;
  user: string;
} {
  return Boolean(
    event?.channel &&
      event.ts &&
      event.user &&
      !event.bot_id &&
      event.text?.trim() &&
      (event.type === "app_mention" ||
        (event.type === "message" &&
          event.channel_type === "im" &&
          HUMAN_MESSAGE_SUBTYPES.has(event.subtype))),
  );
}

function isPublicOrPrivateChannel(event: SlackEvent): boolean {
  if (event.channel_type === "channel" || event.channel_type === "group") {
    return true;
  }
  if (event.channel_type) return false;
  const channelId = event.channel ?? "";
  return channelId.startsWith("C") || channelId.startsWith("G");
}

export function isHumanChannelMessage(
  event: SlackEvent | undefined,
): event is SlackEvent & {
  channel: string;
  ts: string;
  user: string;
} {
  return Boolean(
    event?.type === "message" &&
      event.channel &&
      isPublicOrPrivateChannel(event) &&
      event.ts &&
      event.user &&
      !event.bot_id &&
      HUMAN_MESSAGE_SUBTYPES.has(event.subtype),
  );
}
