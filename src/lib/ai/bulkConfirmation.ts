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
  srem(key: string, ...members: string[]): Promise<number>;
  del(key: string): Promise<number>;
  multi(): ScopePreviewTransaction;
};

type ScopePreviewTransaction = {
  sadd(key: string, ...members: string[]): ScopePreviewTransaction;
  expire(key: string, ttlSeconds: number): ScopePreviewTransaction;
  exec(): Promise<[Error | null, unknown][] | null>;
};

type RequireCrossMessageConfirmationInput = {
  userId: number;
  sessionId: string;
  operationKey: string;
  subjectKeys?: string[];
  confirmed?: boolean;
  reuseUnchangedPreview?: boolean;
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

async function requireScopedConfirmation(
  redis: BulkConfirmationRedis,
  scopeKey: string,
  operationKey: string,
  subjectKeys: string[],
  confirmed: boolean | undefined,
  previewsIssuedThisRequest: Set<string>,
  reuseUnchangedPreview: boolean
): Promise<"preview" | "proceed"> {
  const subjects = [...new Set(subjectKeys)];
  const preview = async () => {
    if (!reuseUnchangedPreview) previewsIssuedThisRequest.add(operationKey);
    if (subjects.length > 0) {
      const results = await redis
        .multi()
        .sadd(scopeKey, ...subjects)
        .expire(scopeKey, PREVIEW_TOKEN_TTL_SECONDS)
        .exec();
      const failed = !results || results.some(([error]) => error);
      if (failed) {
        await redis.del(scopeKey);
        throw new Error("bulk confirmation scope was not stored with its expiry");
      }
      if (Number(results[0][1]) > 0) previewsIssuedThisRequest.add(operationKey);
    }
    return "preview" as const;
  };

  if (!confirmed || previewsIssuedThisRequest.has(operationKey) || subjects.length === 0) {
    return await preview();
  }
  const consumed = await redis.srem(scopeKey, ...subjects);
  if (consumed === subjects.length) return "proceed";
  return await preview();
}

export async function requireCrossMessageConfirmation({
  userId,
  sessionId,
  operationKey,
  subjectKeys,
  confirmed,
  reuseUnchangedPreview = false,
  previewsIssuedThisRequest,
  getRedisClient = getRedis,
}: RequireCrossMessageConfirmationInput): Promise<"preview" | "proceed"> {
  const operationHash = createHash("sha256").update(operationKey).digest("hex");
  const tokenKey = `ai_bulk_confirm:${userId}:${sessionId}:${operationHash}`;

  try {
    const redis = await getRedisClient();
    if (subjectKeys) {
      return await requireScopedConfirmation(
        redis,
        `ai_bulk_scope:${userId}:${sessionId}:${operationHash}`,
        operationKey,
        subjectKeys,
        confirmed,
        previewsIssuedThisRequest,
        reuseUnchangedPreview
      );
    }
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
