import { randomUUID } from "node:crypto";
import { getRedis } from "@/lib/redis";
import {
  SKILL_OFFER_SCAN_COOLDOWN_SECONDS,
  SKILL_OFFER_TTL_SECONDS,
  type SkillOfferRecord,
  type SkillOfferStatus,
  type VerifiedSkillOffer,
} from "./contract";

const offerKey = (userId: number, id: string) => `ai-skill-offer:${userId}:${id}`;
const offeredKey = (userId: number, projectId: number, pattern: string) =>
  `ai-skill-offer:offered:${userId}:${projectId}:${pattern}`;
const scanKey = (userId: number, projectId: number) =>
  `ai-skill-offer:scan:${userId}:${projectId}`;
const logKey = (projectId: number) => `ai-skill-offer:log:${projectId}`;

export type SkillOfferDecision = "drafted" | "dismissed" | "saved";

export async function claimSkillOfferScan(userId: number, projectId: number) {
  const redis = await getRedis();
  const claimed = await redis.set(
    scanKey(userId, projectId),
    "1",
    "EX",
    SKILL_OFFER_SCAN_COOLDOWN_SECONDS,
    "NX",
  );
  return claimed === "OK";
}

export async function createSkillOffer(args: {
  userId: number;
  projectId: number;
  sessionId: string;
  offer: VerifiedSkillOffer;
}): Promise<SkillOfferRecord | null> {
  const redis = await getRedis();
  const claimed = await redis.set(
    offeredKey(args.userId, args.projectId, args.offer.key),
    "1",
    "NX",
  );
  if (claimed !== "OK") return null;

  const record: SkillOfferRecord = {
    ...args.offer,
    id: randomUUID(),
    userId: args.userId,
    projectId: args.projectId,
    sessionId: args.sessionId,
    createdAt: new Date().toISOString(),
    status: "pending",
  };
  await redis.set(offerKey(args.userId, record.id), JSON.stringify(record), "EX", SKILL_OFFER_TTL_SECONDS);
  return record;
}

export async function loadSkillOffer(userId: number, id: string): Promise<SkillOfferRecord | null> {
  const redis = await getRedis();
  const raw = await redis.get(offerKey(userId, id));
  if (!raw) return null;
  const record = JSON.parse(raw) as SkillOfferRecord;
  if (record.userId !== userId || record.id !== id) return null;
  return record;
}

export async function decideSkillOffer(args: {
  userId: number;
  id: string;
  decision: SkillOfferDecision;
}): Promise<SkillOfferRecord | null> {
  const redis = await getRedis();
  const lockKey = `ai-skill-offer:lock:${args.userId}:${args.id}`;
  const token = randomUUID();
  if ((await redis.set(lockKey, token, "EX", 30, "NX")) !== "OK") {
    throw new Error("This suggestion is already being updated.");
  }
  try {
    const record = await loadSkillOffer(args.userId, args.id);
    if (!record) return null;
    if (record.status !== "pending") return record;

    const status: SkillOfferStatus = args.decision === "dismissed" ? "dismissed" : args.decision === "saved" ? "saved" : "drafted";
    const updated: SkillOfferRecord = { ...record, status };
    await redis.set(offerKey(args.userId, record.id), JSON.stringify(updated), "EX", SKILL_OFFER_TTL_SECONDS);
    await redis.hincrby(logKey(record.projectId), `${record.kind}:${status}`, 1);
    return updated;
  } finally {
    await redis.del(lockKey).catch(() => undefined);
  }
}
