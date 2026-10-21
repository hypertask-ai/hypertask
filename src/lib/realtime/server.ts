import Pusher from "pusher";
import { waitUntil } from "@vercel/functions";
import {
  BOARD_EVENT,
  COMMENT_EVENT,
  INBOX_EVENT,
  TASK_EVENT,
  TIME_EVENT,
  AGENT_CHAT_EVENT,
  FEATURE_FLAGS_EVENT,
  boardChannel,
  featureFlagsChannel,
  taskChannel,
  timeBoardChannel,
  timeTaskChannel,
  userChannel,
} from "./shared";
export {
  BOARD_EVENT,
  COMMENT_EVENT,
  INBOX_EVENT,
  TASK_EVENT,
  TIME_EVENT,
  AGENT_CHAT_EVENT,
  FEATURE_FLAGS_EVENT,
  boardChannel,
  featureFlagsChannel,
  taskChannel,
  timeBoardChannel,
  timeTaskChannel,
  userChannel,
} from "./shared";


const APP_ID = process.env.PUSHER_APP_ID;
const KEY = process.env.PUSHER_KEY;
const SECRET = process.env.PUSHER_SECRET;
const HOST = process.env.PUSHER_HOST;
const PORT = process.env.PUSHER_PORT;
const USE_TLS = process.env.PUSHER_USE_TLS === "true";
const CLUSTER = process.env.PUSHER_CLUSTER || "mt1";

export function isRealtimeConfigured(): boolean {
  return Boolean(APP_ID && KEY && SECRET);
}

let server: Pusher | null = null;

export function getRealtimeServer(): Pusher | null {
  if (!isRealtimeConfigured()) return null;
  if (server) return server;
  server = new Pusher({
    appId: APP_ID!,
    key: KEY!,
    secret: SECRET!,
    useTLS: USE_TLS,
    ...(HOST ? { host: HOST, port: PORT || "6001", cluster: CLUSTER } : { cluster: CLUSTER }),
  });
  return server;
}

export async function broadcast(
  channel: string,
  event: string,
  payload?: Record<string, unknown>,
  excludeSocketId?: string
): Promise<void> {
  const s = getRealtimeServer();
  if (!s) return;
  const p = s
    .trigger(
      channel,
      event,
      payload ?? {},
      excludeSocketId ? { socket_id: excludeSocketId } : undefined
    )
    .then(() => undefined)
    .catch((e) => console.warn("[realtime] broadcast failed", channel, event, e));
  waitUntil(p);
  await p;
}

export function socketIdFromHeader(
  headerValue: string | string[] | null | undefined
): string | undefined {
  const v = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return v && /^\d+\.\d+$/.test(v) ? v : undefined;
}

export async function broadcastBoardChange(
  projectId: number | null | undefined,
  payload?: { originUserId?: number }
): Promise<void> {
  if (projectId == null) return;
  await broadcast(boardChannel(projectId), BOARD_EVENT, payload);
}

export async function broadcastTaskChange(
  taskId: number | null | undefined,
  payload?: { originUserId?: number }
): Promise<void> {
  if (taskId == null) return;
  await broadcast(taskChannel(taskId), TASK_EVENT, payload);
}

export async function broadcastTaskComment(
  taskId: number | null | undefined,
  payload?: { originUserId?: number; comment?: unknown }
): Promise<void> {
  if (taskId == null) return;
  await broadcast(taskChannel(taskId), COMMENT_EVENT, payload as Record<string, unknown>);
}

export async function broadcastTimeChange(
  taskId: number | null | undefined,
  projectId?: number | null
): Promise<void> {
  if (taskId == null) return;
  await broadcast(timeTaskChannel(taskId), TIME_EVENT);
  if (projectId != null) await broadcast(timeBoardChannel(projectId), TIME_EVENT);
}

export async function broadcastInboxChange(
  userId: number | null | undefined,
  payload?: { originUserId?: number },
  excludeSocketId?: string
): Promise<void> {
  if (userId == null) return;
  await broadcast(userChannel(userId), INBOX_EVENT, payload, excludeSocketId);
}

export async function broadcastFeatureFlagsChange(): Promise<void> {
  await broadcast(featureFlagsChannel(), FEATURE_FLAGS_EVENT);
}
