import type { SerializedAgentRunActivity } from "@/lib/agentRuns/model";
import type { IComment } from "@/models/model";

export type TaskThreadFeedItem =
  | { kind: "comment"; commentIndex: number; id: string; createdAt: string }
  | {
      kind: "agent-activity";
      activityIndex: number;
      id: string;
      createdAt: string;
    };

const timestamp = (value: string | Date) => {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

export function safeAgentRunActivityLink(link: string | null): string | null {
  if (!link) return null;
  try {
    const parsed = new URL(link);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

export function mergeTaskThreadFeed(
  comments: IComment[],
  activities: SerializedAgentRunActivity[],
  showHistory: boolean,
): TaskThreadFeedItem[] {
  const feed: TaskThreadFeedItem[] = [];

  comments.forEach((comment, commentIndex) => {
    if (!showHistory && comment.activity) return;
    feed.push({
      kind: "comment",
      commentIndex,
      id: `comment-${comment.id}`,
      createdAt: new Date(comment.createdAt).toISOString(),
    });
  });

  activities.forEach((activity, activityIndex) => {
    if (activity.type === "response") return;
    feed.push({
      kind: "agent-activity",
      activityIndex,
      id: `agent-activity-${activity.id}`,
      createdAt: activity.createdAt,
    });
  });

  return feed.sort((left, right) => {
    const byTime = timestamp(left.createdAt) - timestamp(right.createdAt);
    return byTime || left.id.localeCompare(right.id);
  });
}
