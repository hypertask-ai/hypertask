import { randomUUID } from "crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { getRedis } from "@/lib/redis";
import {
  agentMessageMarker,
  encodeAgentMessage,
} from "@/lib/nativeAgent/agentMessageEnvelope";

const DELIVERY_LOCK_TTL_MS = 30_000;

type NotificationDb = Pick<PrismaClient, "notification" | "$transaction">;
type DeliveryRedis = Pick<Awaited<ReturnType<typeof getRedis>>, "set" | "eval">;

const releaseLock = async (
  redis: DeliveryRedis,
  key: string,
  token: string,
) => {
  await redis.eval(
    `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      end
      return 0
    `,
    1,
    key,
    token,
  );
};

export async function deliverAgentMessageNotification({
  db,
  assistantMessageId,
  userId,
  agentId,
  content,
  redisClient,
}: {
  db: NotificationDb;
  assistantMessageId: string;
  userId: number;
  agentId: string;
  content: string;
  redisClient?: DeliveryRedis;
}): Promise<"created" | "existing" | "busy"> {
  const marker = agentMessageMarker(assistantMessageId);
  const where = {
    type: "AgentMessage" as const,
    userId,
    fromAgentId: agentId,
    message: { startsWith: marker },
  };
  if (await db.notification.findFirst({ where, select: { id: true } })) {
    return "existing";
  }

  // QStash/cron delivery is at-least-once. Redis serializes concurrent retries;
  // the durable marker in Notification handles a crash after the insert but
  // before the lock/result can be acknowledged.
  const redis = redisClient ?? (await getRedis());
  const lockKey = `native-agent-heartbeat:delivery-lock:v1:${assistantMessageId}`;
  const lockToken = randomUUID();
  const locked = await redis.set(
    lockKey,
    lockToken,
    "PX",
    DELIVERY_LOCK_TTL_MS,
    "NX",
  );
  if (locked !== "OK") return "busy";

  try {
    // The serializable transaction is the final duplicate guard if a process
    // stalls past the Redis lease. One concurrent predicate-read/insert wins;
    // PostgreSQL aborts the other, whose next retry observes the durable row.
    return await db.$transaction(
      async (transaction) => {
        if (
          await transaction.notification.findFirst({
            where,
            select: { id: true },
          })
        ) {
          return "existing" as const;
        }
        await transaction.notification.create({
          data: {
            type: "AgentMessage",
            userId,
            fromAgentId: agentId,
            message: encodeAgentMessage(assistantMessageId, content),
            taskId: null,
            projectId: null,
          },
        });
        return "created" as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } finally {
    await releaseLock(redis, lockKey, lockToken).catch(() => undefined);
  }
}
