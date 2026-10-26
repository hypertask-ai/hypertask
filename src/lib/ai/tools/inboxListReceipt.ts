import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getRedis } from "@/lib/redis";

const receiptIds = z.array(z.number().int().positive());
const receiptKey = (userId: number, sessionId: string, token: string) =>
  `ai_inbox_list:${userId}:${sessionId}:${token}`;

export async function recordInboxList(
  userId: number,
  sessionId: string,
  notificationIds: number[]
) {
  const token = randomUUID();
  const redis = await getRedis();
  await redis.set(receiptKey(userId, sessionId, token), JSON.stringify(notificationIds), "EX", 900);
  return token;
}

export async function inboxListCoversBatch(
  userId: number,
  sessionId: string,
  tokens: string[],
  notificationIds: number[]
) {
  const redis = await getRedis();
  const listed = new Set<number>();
  for (const token of new Set(tokens)) {
    const stored = await redis.get(receiptKey(userId, sessionId, token));
    if (!stored) return false;
    const ids = receiptIds.parse(JSON.parse(stored));
    for (const id of ids) listed.add(id);
  }
  return notificationIds.every((id) => listed.has(id));
}

export async function recordInboxCursor(userId: number, sessionId: string, ids: number[]) {
  const token = randomUUID();
  const redis = await getRedis();
  await redis.set(`ai_inbox_cursor:${userId}:${sessionId}:${token}`, JSON.stringify(ids), "EX", 900);
  return token;
}

export async function readInboxCursor(userId: number, sessionId: string, token: string) {
  const redis = await getRedis();
  const stored = await redis.get(`ai_inbox_cursor:${userId}:${sessionId}:${token}`);
  return stored ? z.array(z.number().int()).parse(JSON.parse(stored)) : null;
}
