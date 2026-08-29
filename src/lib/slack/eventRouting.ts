import { hasSlackCreateTaskIntent } from "@/lib/slack/taskCreateIntent";

export type SlackEvent = {
  assistant_thread?: {
    channel_id?: string;
    thread_ts?: string;
    user_id?: string;
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

export function routeSlackEvent(event: SlackEvent | undefined): SlackEventRoute {
  if (isCreateTaskMention(event)) return "create_task";
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

export function extractSlackMentionText(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/gi, "").trim();
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

export function isHumanChannelMessage(
  event: SlackEvent | undefined,
): event is SlackEvent & {
  channel: string;
  ts: string;
  user: string;
} {
  return Boolean(
    event?.type === "message" &&
      (event.channel_type === "channel" || event.channel_type === "group") &&
      event.channel &&
      event.ts &&
      event.user &&
      !event.bot_id &&
      HUMAN_MESSAGE_SUBTYPES.has(event.subtype),
  );
}
