import { createHash } from "node:crypto";

import { getRedis } from "@/lib/redis";

const PREVIEW_TOKEN_TTL_SECONDS = 900;

type BulkConfirmationRedis = {
  getdel(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    expiryMode: "EX",
    ttlSeconds: number
  ): Promise<unknown>;
};

type RequireCrossMessageConfirmationInput = {
  userId: number;
  sessionId: string;
  operationKey: string;
  confirmed?: boolean;
  previewsIssuedThisRequest: Set<string>;
  getRedisClient?: () => Promise<BulkConfirmationRedis>;
};

async function recordPreview(
  redis: BulkConfirmationRedis,
  tokenKey: string,
  operationKey: string,
  previewsIssuedThisRequest: Set<string>
) {
  previewsIssuedThisRequest.add(operationKey);
  await redis.set(tokenKey, "1", "EX", PREVIEW_TOKEN_TTL_SECONDS);
  return "preview" as const;
}

// Model guidance cannot prove that a user approved a write, so the token proves
// an earlier request issued the exact preview. Store failures stay closed because
// an unavailable security gate must never authorize the write.
export async function requireCrossMessageConfirmation({
  userId,
  sessionId,
  operationKey,
  confirmed,
  previewsIssuedThisRequest,
  getRedisClient = getRedis,
}: RequireCrossMessageConfirmationInput): Promise<"preview" | "proceed"> {
  const operationHash = createHash("sha256").update(operationKey).digest("hex");
  const tokenKey = `ai_bulk_confirm:${userId}:${sessionId}:${operationHash}`;

  try {
    const redis = await getRedisClient();
    if (previewsIssuedThisRequest.has(operationKey)) {
      return await recordPreview(
        redis,
        tokenKey,
        operationKey,
        previewsIssuedThisRequest
      );
    }
    if (!confirmed) {
      return await recordPreview(
        redis,
        tokenKey,
        operationKey,
        previewsIssuedThisRequest
      );
    }

    const storedPreview = await redis.getdel(tokenKey);
    if (storedPreview) return "proceed";

    return await recordPreview(
      redis,
      tokenKey,
      operationKey,
      previewsIssuedThisRequest
    );
  } catch {
    previewsIssuedThisRequest.add(operationKey);
    return "preview";
  }
}
