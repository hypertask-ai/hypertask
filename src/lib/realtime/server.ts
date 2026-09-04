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

// Real-time sync (HTPR-3795). Server side: after a change we trigger one event
// on a scoped channel; subscribed clients react (refetch or patch).
// Speaks the Pusher protocol, so this works against hosted Pusher, Ably, or a
// self-hosted/local Soketi server by swapping env vars only.

const APP_ID = process.env.PUSHER_APP_ID;
const KEY = process.env.PUSHER_KEY;
const SECRET = process.env.PUSHER_SECRET;
const HOST = process.env.PUSHER_HOST; // set for Soketi / self-host
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
    // Soketi / self-host: pin host+port. Hosted Pusher: use cluster.
    ...(HOST ? { host: HOST, port: PORT || "6001", cluster: CLUSTER } : { cluster: CLUSTER }),
  });
  return server;
}

// Generic publish. Fire-and-forget: never throws, never blocks a mutation,
// no-ops when realtime isn't configured so the app runs fine without pub/sub.
// excludeSocketId (Pusher-native socket_id exclusion) skips the client that
// caused the mutation: it already updated its own cache optimistically, so
// echoing back a refetch only wastes a full reload. Other tabs, other users,
// and the CLI/MCP (no socket id) still get the event.
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
  // Callers fire-and-forget (`void broadcast(...)`) so mutations never block on
  // the Pusher HTTP call. But on Vercel the function freezes the instant the
  // response is sent, so that detached promise is usually dropped and the event
  // is lost (HTPR-3999). waitUntil keeps the serverless instance alive until the
  // trigger completes; outside a Vercel request context (local server, scripts)
  // it no-ops and the promise finishes on its own since the process never freezes.
  waitUntil(p);
  await p;
}

// Pull the acting tab's Pusher socket id off a request (HTPR-3998). Clients
// send it as an X-Socket-Id header on mutations so their own broadcast echo
// can be suppressed. Absent header (CLI, MCP, older clients) = no exclusion.
export function socketIdFromHeader(
  headerValue: string | string[] | null | undefined
): string | undefined {
  const v = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  // Pusher socket ids look like "123456.654321" — ignore anything else.
  return v && /^\d+\.\d+$/.test(v) ? v : undefined;
}

// Board: a task on this board was created/updated/moved/deleted/archived.
export async function broadcastBoardChange(
  projectId: number | null | undefined,
  payload?: { originUserId?: number }
): Promise<void> {
  if (projectId == null) return;
  await broadcast(boardChannel(projectId), BOARD_EVENT, payload);
}

// Task view: task title/description/detail changed.
export async function broadcastTaskChange(
  taskId: number | null | undefined,
  payload?: { originUserId?: number }
): Promise<void> {
  if (taskId == null) return;
  await broadcast(taskChannel(taskId), TASK_EVENT, payload);
}

// Task view: a comment/activity on this task changed.
export async function broadcastTaskComment(
  taskId: number | null | undefined,
  payload?: { originUserId?: number; comment?: unknown }
): Promise<void> {
  if (taskId == null) return;
  await broadcast(taskChannel(taskId), COMMENT_EVENT, payload as Record<string, unknown>);
}

// Task view + board: a timer on this task started or stopped. Its own event
// so a timer tick does not force the task detail and activity feed to refetch
// (HTPR-4700).
export async function broadcastTimeChange(
  taskId: number | null | undefined,
  projectId?: number | null
): Promise<void> {
  if (taskId == null) return;
  await broadcast(timeTaskChannel(taskId), TIME_EVENT);
  if (projectId != null) await broadcast(timeBoardChannel(projectId), TIME_EVENT);
}

// Inbox: this user's notifications changed.
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
