export type AgentChatMessage = {
  id: string;
  role: "human" | "assistant";
  content: string;
  createdAt: string;
};

export type AgentChatActivity = {
  id: string;
  kind: "event";
  type: "thought" | "action" | "error" | "elicitation";
  text: string;
  link: string | null;
  createdAt: string;
  task: {
    id: number;
    ticketNumber: string;
    title: string;
    url: string;
  } | null;
};

export type AgentChatFeedItem =
  ({ kind: "message" } & AgentChatMessage) | AgentChatActivity;

export type AgentChatFilter = "all" | "chat" | "activity";

export type AgentChatActivityGroup = {
  kind: "event-group";
  id: string;
  task: AgentChatActivity["task"];
  events: AgentChatActivity[];
};

export type AgentChatDisplayItem =
  ({ kind: "message" } & AgentChatMessage) | AgentChatActivityGroup;

export const compareAgentChatFeedItems = (
  a: AgentChatFeedItem,
  b: AgentChatFeedItem,
) => {
  const byTime = a.createdAt.localeCompare(b.createdAt);
  if (byTime !== 0) return byTime;
  if (a.id.startsWith("run-") !== b.id.startsWith("run-")) {
    return a.id.startsWith("run-") ? -1 : 1;
  }
  return a.id.localeCompare(b.id);
};

export function mergeAgentChatFeed(
  messages: AgentChatMessage[],
  activity: AgentChatActivity[],
): AgentChatFeedItem[] {
  return [
    ...messages.map((message) => ({ ...message, kind: "message" as const })),
    ...activity,
  ].sort(compareAgentChatFeedItems);
}

export function displayAgentChatFeed(
  feed: AgentChatFeedItem[],
  filter: AgentChatFilter,
): AgentChatDisplayItem[] {
  const grouped: AgentChatDisplayItem[] = [];
  for (const item of feed) {
    if (item.kind === "message") {
      grouped.push(item);
      continue;
    }
    const previous = grouped[grouped.length - 1];
    if (
      item.task &&
      previous?.kind === "event-group" &&
      previous.task?.id === item.task.id
    ) {
      previous.events.push(item);
      continue;
    }
    grouped.push({
      kind: "event-group",
      id: `group-${item.id}`,
      task: item.task,
      events: [item],
    });
  }
  if (filter === "chat") {
    return grouped.filter((item) => item.kind === "message");
  }
  if (filter === "activity") {
    return grouped.filter((item) => item.kind === "event-group");
  }
  return grouped;
}

export function lastAgentChatMessage(
  feed: AgentChatFeedItem[],
): AgentChatMessage | null {
  for (let index = feed.length - 1; index >= 0; index -= 1) {
    if (feed[index].kind === "message") return feed[index] as AgentChatMessage;
  }
  return null;
}

export function asksForAgentActivity(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return [
    "what are you doing",
    "what are you working on",
    "what have you been doing",
    "what have you worked on",
  ].some((phrase) => normalized.includes(phrase));
}

export function activityContextMessages(
  activity: AgentChatActivity[],
  limit = 10,
) {
  const normalizedLimit = Number.isFinite(limit)
    ? Math.max(0, Math.trunc(limit))
    : 0;
  if (normalizedLimit === 0) return [];
  return activity
    .filter((item) => item.type === "action" || item.type === "error")
    .slice(-normalizedLimit)
    .map((item) => ({
      id: `context-${item.id}`,
      kind: "event" as const,
      role: "activity" as const,
      content: JSON.stringify({
        ticket: item.task?.ticketNumber ?? null,
        status: item.text.replace(/\s+/g, " ").trim().slice(0, 500),
      }),
      createdAt: item.createdAt,
    }));
}
