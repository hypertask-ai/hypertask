import type {
  FeatureFlagMode as PrismaFeatureFlagMode,
  PrismaClient,
} from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const FEATURE_FLAG_OWNER = {
  userId: 6,
  email: "valentin.yeo@gmail.com",
} as const;
const FEATURE_FLAG_QA_USER = {
  userId: 985,
  email: "valentin@hypertask.ai",
} as const;

export const FEATURE_FLAG_KEYS = [
  "htpr-5913-consistent-comment-shortcuts",
  "htpr-5992-mobile-all-tasks",
  "htpr-5993-optimistic-task-uploads",
  "htpr-6072-shallow-board-switch",
  "htpr-6091-feature-flags",
  "htpr-6112-copy-current-url",
  "htpr-6115-agent-sdk",
  "htpr-6116-figma-node-preview",
  "htpr-6118-comment-reactions-api",
  "htpr-6122-agent-run-activities",
  "htpr-6129-mobile-agent-chat-viewport",
  "htpr-6130-mobile-reminder-safe-area",
  "htpr-6141-ai-first-task-writer",
] as const;
// HTPR-6128 explicitly exempts this bootstrap mode: gating flag infrastructure by itself is circular.
export const FEATURE_FLAG_MODES = [
  "OWNER_ONLY",
  "OWNER_AND_QA",
  "EVERYONE",
  "OFF",
] as const;
export type FeatureFlagMode = PrismaFeatureFlagMode;

const defaultFeatureFlagMode = (key: string): FeatureFlagMode =>
  key === "htpr-6072-shallow-board-switch" ||
  key === "htpr-6122-agent-run-activities" ||
  key === "htpr-6129-mobile-agent-chat-viewport" ||
  key === "htpr-6130-mobile-reminder-safe-area" ||
  key === "htpr-6141-ai-first-task-writer"
    ? "OWNER_ONLY"
    : "OWNER_AND_QA";

export class FeatureFlagInputError extends Error {}

type FeatureFlagDatabase = {
  featureFlag: Pick<PrismaClient["featureFlag"], "findUnique">;
  user: Pick<PrismaClient["user"], "findUnique">;
};

async function matchesFeatureFlagIdentity(
  userId: number,
  identity: { userId: number; email: string },
  db: FeatureFlagDatabase = prisma,
): Promise<boolean> {
  if (userId !== identity.userId) return false;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  return user?.email.trim().toLowerCase() === identity.email;
}

const isFeatureFlagOwnerUser = (
  userId: number,
  db: FeatureFlagDatabase = prisma,
) => matchesFeatureFlagIdentity(userId, FEATURE_FLAG_OWNER, db);

const isFeatureFlagQaUser = (
  userId: number,
  db: FeatureFlagDatabase = prisma,
) => matchesFeatureFlagIdentity(userId, FEATURE_FLAG_QA_USER, db);

export async function isFeatureFlagOwner(headers: Headers): Promise<boolean> {
  const session = await getSessionUser(headers);
  return session ? isFeatureFlagOwnerUser(session.userId) : false;
}

export type FeatureFlagRow = {
  key: string;
  mode: FeatureFlagMode;
  updatedAt: Date | null;
};

export function featureFlagModeEnabled(
  mode: FeatureFlagMode,
  isOwner: boolean,
  isQa: boolean,
): boolean {
  if (mode === "EVERYONE") return true;
  if (mode === "OWNER_AND_QA") return isOwner || isQa;
  if (mode === "OWNER_ONLY") return isOwner;
  return false;
}

export async function isFeatureEnabled(
  key: string,
  userId: number,
  db: FeatureFlagDatabase = prisma,
): Promise<boolean> {
  const row = await db.featureFlag.findUnique({
    where: { key },
    select: { mode: true },
  });
  const declared = (FEATURE_FLAG_KEYS as readonly string[]).includes(key);
  if (!row && !declared) return false;
  const mode = row?.mode ?? defaultFeatureFlagMode(key);
  const includesOwner = mode === "OWNER_ONLY" || mode === "OWNER_AND_QA";
  return featureFlagModeEnabled(
    mode,
    includesOwner && (await isFeatureFlagOwnerUser(userId, db)),
    mode === "OWNER_AND_QA" && (await isFeatureFlagQaUser(userId, db)),
  );
}

export async function listFeatureFlagModes(): Promise<FeatureFlagRow[]> {
  const stored = await prisma.featureFlag.findMany({
    select: { key: true, mode: true, updatedAt: true },
    orderBy: { key: "asc" },
  });
  const byKey = new Map<string, FeatureFlagRow>(
    FEATURE_FLAG_KEYS.map((key) => [
      key,
      { key, mode: defaultFeatureFlagMode(key), updatedAt: null },
    ]),
  );
  stored.forEach((row) => byKey.set(row.key, row));
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export async function featureFlagsForUser(
  userId: number,
): Promise<Record<string, boolean>> {
  const rows = await listFeatureFlagModes();
  const isOwner = rows.some(
    (row) => row.mode === "OWNER_ONLY" || row.mode === "OWNER_AND_QA",
  )
    ? await isFeatureFlagOwnerUser(userId)
    : false;
  const isQa = rows.some((row) => row.mode === "OWNER_AND_QA")
    ? await isFeatureFlagQaUser(userId)
    : false;
  return Object.fromEntries(
    rows.map((row) => [
      row.key,
      featureFlagModeEnabled(row.mode, isOwner, isQa),
    ]),
  );
}

export function validFeatureFlagKey(key: string): boolean {
  return key.length <= 100 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key);
}

export async function setFeatureFlagMode(
  key: string,
  mode: FeatureFlagMode,
): Promise<FeatureFlagRow> {
  if (!validFeatureFlagKey(key) || !FEATURE_FLAG_MODES.includes(mode)) {
    throw new FeatureFlagInputError("Invalid feature flag");
  }
  const declared = (FEATURE_FLAG_KEYS as readonly string[]).includes(key);
  const existing = declared
    ? true
    : Boolean(await prisma.featureFlag.findUnique({ where: { key }, select: { key: true } }));
  if (!existing) throw new FeatureFlagInputError("Unknown feature flag");

  return prisma.featureFlag.upsert({
    where: { key },
    create: { key, mode },
    update: { mode },
    select: { key: true, mode: true, updatedAt: true },
  });
}
