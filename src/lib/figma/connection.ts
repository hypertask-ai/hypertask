import { Prisma } from "@prisma/client";

import { decryptSecret, encryptSecret } from "@/lib/crypto/byokCipher";
import { FIGMA_CONNECT_FLAG, isFeatureEnabled } from "@/lib/flags";
import prisma from "@/lib/prisma";
import {
  FigmaOAuthRequestError,
  getFigmaOAuthConfig,
  refreshFigmaToken,
  type FigmaToken,
} from "./oauth";

const FIGMA_LOCK_NAMESPACE = 1_179_207_757;
const REFRESH_SKEW_MS = 60_000;

type ConnectedToken = FigmaToken & {
  figmaUserName: string | null;
  refreshToken: string;
  userId: string;
};

export const figmaConnectEnabledFor = (userId: number) =>
  isFeatureEnabled(FIGMA_CONNECT_FLAG, userId);

async function withFigmaConnectionLock<T>(
  userId: number,
  action: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(${FIGMA_LOCK_NAMESPACE}::int, ${userId}::int)`,
      );
      return action(tx);
    },
    { maxWait: 5000, timeout: 15_000 },
  );
}

export async function connectFigmaUser(
  userId: number,
  issueToken: () => Promise<ConnectedToken>,
) {
  return withFigmaConnectionLock(userId, async (tx) => {
    const token = await issueToken();
    const data = {
      encryptedAccessToken: encryptSecret(token.accessToken),
      encryptedRefreshToken: encryptSecret(token.refreshToken),
      expiresAt: token.expiresAt,
      figmaUserId: token.userId,
      figmaUserName: token.figmaUserName,
    };
    return tx.figmaConnection.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
      select: { figmaUserId: true, figmaUserName: true, updatedAt: true },
    });
  });
}

export async function disconnectFigmaUser(userId: number): Promise<void> {
  await withFigmaConnectionLock(userId, async (tx) => {
    await tx.figmaConnection.deleteMany({ where: { userId } });
  });
}

export function getFigmaConnection(userId: number) {
  return prisma.figmaConnection.findUnique({
    where: { userId },
    select: { figmaUserId: true, figmaUserName: true },
  });
}

export async function getFigmaAccessToken(
  userId: number,
  nowMs = Date.now(),
): Promise<string | null> {
  const current = await prisma.figmaConnection.findUnique({
    where: { userId },
    select: {
      encryptedAccessToken: true,
      expiresAt: true,
    },
  });
  if (!current) return null;
  if (current.expiresAt.getTime() > nowMs + REFRESH_SKEW_MS) {
    return decryptSecret(current.encryptedAccessToken);
  }

  return withFigmaConnectionLock(userId, async (tx) => {
    const connection = await tx.figmaConnection.findUnique({
      where: { userId },
      select: {
        encryptedAccessToken: true,
        encryptedRefreshToken: true,
        expiresAt: true,
      },
    });
    if (!connection) return null;
    if (connection.expiresAt.getTime() > nowMs + REFRESH_SKEW_MS) {
      return decryptSecret(connection.encryptedAccessToken);
    }

    const config = getFigmaOAuthConfig();
    if (!config) throw new Error("Figma OAuth is not configured");
    const refreshToken = decryptSecret(connection.encryptedRefreshToken);
    try {
      const refreshed = await refreshFigmaToken(
        refreshToken,
        config,
        nowMs,
      );
      await tx.figmaConnection.update({
        where: { userId },
        data: {
          encryptedAccessToken: encryptSecret(refreshed.accessToken),
          encryptedRefreshToken: encryptSecret(
            refreshed.refreshToken ?? refreshToken,
          ),
          expiresAt: refreshed.expiresAt,
        },
      });
      return refreshed.accessToken;
    } catch (error) {
      if (
        error instanceof FigmaOAuthRequestError &&
        error.oauthError === "invalid_grant"
      ) {
        await tx.figmaConnection.delete({ where: { userId } });
        return null;
      }
      throw error;
    }
  });
}
