import { getRedis } from "@/lib/redis";
import type { SlackEvent } from "@/lib/slack/eventRouting";
import type { SlackActor } from "@/lib/slack/userLink";

const THREAD_TTL_SECONDS = 24 * 60 * 60;
const MAX_HISTORY_CHARACTERS = 8_000;
const APPEND_HISTORY_SCRIPT = `
local history = (redis.call('HGET', KEYS[1], ARGV[1]) or '') .. ARGV[2]
local start = math.max(1, #history - tonumber(ARGV[3]) + 1)
-- Redis strings are bytes; skip continuation bytes to preserve UTF-8.
while start <= #history and string.byte(history, start) >= 128 and string.byte(history, start) < 192 do
  start = start + 1
end
redis.call('HSET', KEYS[1], ARGV[1], string.sub(history, start))
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))
return 1
`;

type ThreadIdentity = {
  installId: string;
  channelId: string;
  slackUserId: string;
  threadTs: string;
};

function threadKey(input: ThreadIdentity): string {
  return `slack:assistant:${input.installId}:${input.channelId}:${input.threadTs}:${input.slackUserId}`;
}

export async function saveSlackAssistantContext(
  installId: string,
  slackTeamId: string,
  thread: NonNullable<SlackEvent["assistant_thread"]>,
): Promise<void> {
  if (!thread.channel_id || !thread.thread_ts || !thread.user_id) return;
  const context = thread.context;
  if (context?.team_id && context.team_id !== slackTeamId) return;
  const redis = await getRedis();
  const key = threadKey({
    installId,
    channelId: thread.channel_id,
    slackUserId: thread.user_id,
    threadTs: thread.thread_ts,
  });
  const metadata = Object.fromEntries(
    Object.entries(context ?? {})
      .filter(([field, value]) => ["channel_id", "team_id", "enterprise_id"].includes(field) && typeof value === "string")
      .map(([field, value]) => [field, value!.slice(0, 80)]),
  );
  await redis.hset(key, "context", JSON.stringify(metadata));
  await redis.expire(key, THREAD_TTL_SECONDS);
}

export async function loadSlackChatContext(
  actor: SlackActor,
  input: { channelId: string; threadTs: string },
): Promise<string> {
  const redis = await getRedis();
  const key = threadKey({ ...input, installId: actor.installId, slackUserId: actor.slackUserId });
  const [context, history] = await redis.hmget(key, "context", `history:${actor.user.id}`);
  const metadata = context ? `Slack assistant context (metadata only): ${context}` : "";
  return [metadata, (history ?? "").slice(-(MAX_HISTORY_CHARACTERS - metadata.length - 1))]
    .filter(Boolean)
    .join("\n");
}

export async function saveSlackChatTurn(
  actor: SlackActor,
  input: { channelId: string; threadTs: string },
  message: string,
  blocks: Record<string, unknown>[],
): Promise<void> {
  const redis = await getRedis();
  const key = threadKey({ ...input, installId: actor.installId, slackUserId: actor.slackUserId });
  await redis.eval(
    APPEND_HISTORY_SCRIPT,
    1,
    key,
    `history:${actor.user.id}`,
    `\nUser: ${message}\nHypertask result: ${JSON.stringify(blocks)}`,
    MAX_HISTORY_CHARACTERS,
    THREAD_TTL_SECONDS,
  );
}
