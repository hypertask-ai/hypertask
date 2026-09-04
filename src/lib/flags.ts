import type { FeatureFlagMode as PrismaFeatureFlagMode } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const FEATURE_FLAG_OWNER = {
  userId: 6,
  email: "valentin.yeo@gmail.com",
} as const;

export const FEATURE_FLAG_KEYS = ["htpr-6091-feature-flags"] as const;
export const FEATURE_FLAG_MODES = ["OWNER_ONLY", "EVERYONE", "OFF"] as const;
export type FeatureFlagMode = PrismaFeatureFlagMode;

export class FeatureFlagInputError extends Error {}

async function isFeatureFlagOwnerUser(userId: number): Promise<boolean> {
  if (userId !== FEATURE_FLAG_OWNER.userId) return false;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  return user?.email.trim().toLowerCase() === FEATURE_FLAG_OWNER.email;
}

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
): boolean {
  if (mode === "EVERYONE") return true;
  if (mode === "OWNER_ONLY") return isOwner;
  return false;
}

export async function isFeatureEnabled(
  key: string,
  userId: number,
): Promise<boolean> {
  const row = await prisma.featureFlag.findUnique({
    where: { key },
    select: { mode: true },
  });
  const declared = (FEATURE_FLAG_KEYS as readonly string[]).includes(key);
  if (!row && !declared) return false;
  const mode = row?.mode ?? "OWNER_ONLY";
  return featureFlagModeEnabled(
    mode,
    mode === "OWNER_ONLY" && (await isFeatureFlagOwnerUser(userId)),
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
      { key, mode: "OWNER_ONLY", updatedAt: null },
    ]),
  );
  stored.forEach((row) => byKey.set(row.key, row));
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export async function featureFlagsForUser(
  userId: number,
): Promise<Record<string, boolean>> {
  const rows = await listFeatureFlagModes();
  const isOwner = rows.some((row) => row.mode === "OWNER_ONLY")
    ? await isFeatureFlagOwnerUser(userId)
    : false;
  return Object.fromEntries(
    rows.map((row) => [row.key, featureFlagModeEnabled(row.mode, isOwner)]),
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
