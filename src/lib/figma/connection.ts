import { randomBytes } from "node:crypto";
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
const FIGMA_OPERATION_TTL_MS = 30_000;
const REFRESH_SKEW_MS = 60_000;
const REFRESH_WAIT_INTERVAL_MS = 250;

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

const newOperationId = () => randomBytes(16).toString("base64url");

function setFigmaOperation(
  tx: Prisma.TransactionClient,
  userId: number,
  operationId: string,
  pendingUntil: Date | null,
) {
  return tx.figmaConnectionOperation.upsert({
    where: { userId },
    create: { userId, operationId, pendingUntil },
    update: { operationId, pendingUntil },
  });
}

async function clearPendingOperation(
  userId: number,
  operationId: string,
): Promise<void> {
  await withFigmaConnectionLock(userId, async (tx) => {
    await tx.figmaConnectionOperation.updateMany({
      where: { userId, operationId },
      data: { pendingUntil: null },
    });
  });
}

async function retryFigmaPersistence<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    try {
      return await action();
    } catch {
      throw error;
    }
  }
}

export async function connectFigmaUser(
  userId: number,
  issueToken: () => Promise<ConnectedToken>,
) {
  const operationId = newOperationId();
  await withFigmaConnectionLock(userId, (tx) =>
    setFigmaOperation(
      tx,
      userId,
      operationId,
      new Date(Date.now() + FIGMA_OPERATION_TTL_MS),
    ),
  );

  let token: ConnectedToken;
  try {
    token = await issueToken();
  } catch (error) {
    await clearPendingOperation(userId, operationId).catch(() => {});
    throw error;
  }

  const data = {
    encryptedAccessToken: encryptSecret(token.accessToken),
    encryptedRefreshToken: encryptSecret(token.refreshToken),
    expiresAt: token.expiresAt,
    figmaUserId: token.userId,
    figmaUserName: token.figmaUserName,
  };
  try {
    return await retryFigmaPersistence(() =>
      withFigmaConnectionLock(userId, async (tx) => {
        const operation = await tx.figmaConnectionOperation.findUnique({
          where: { userId },
          select: { operationId: true },
        });
        if (operation?.operationId !== operationId) return null;

        const connection = await tx.figmaConnection.upsert({
          where: { userId },
          create: { userId, ...data },
          update: data,
          select: { figmaUserId: true, figmaUserName: true, updatedAt: true },
        });
        await tx.figmaConnectionOperation.update({
          where: { userId },
          data: { pendingUntil: null },
        });
        return connection;
      }),
    );
  } catch (error) {
    await clearPendingOperation(userId, operationId).catch(() => {});
    throw error;
  }
}

export async function disconnectFigmaUser(userId: number): Promise<void> {
  const operationId = newOperationId();
  await withFigmaConnectionLock(userId, async (tx) => {
    await setFigmaOperation(tx, userId, operationId, null);
    await tx.figmaConnection.deleteMany({ where: { userId } });
  });
}

export function getFigmaConnection(userId: number) {
  return prisma.figmaConnection.findUnique({
    where: { userId },
    select: { figmaUserId: true, figmaUserName: true },
  });
}

async function waitForPendingRefresh(
  userId: number,
  nowMs: number,
): Promise<string | null | undefined> {
  const startedAt = Date.now();
  const waitUntilMs = nowMs + FIGMA_OPERATION_TTL_MS;
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, REFRESH_WAIT_INTERVAL_MS));
    const checkNowMs = nowMs + (Date.now() - startedAt);
    const [connection, operation] = await Promise.all([
      prisma.figmaConnection.findUnique({
        where: { userId },
        select: { encryptedAccessToken: true, expiresAt: true },
      }),
      prisma.figmaConnectionOperation.findUnique({
        where: { userId },
        select: { pendingUntil: true },
      }),
    ]);
    if (!connection) return null;
    if (connection.expiresAt.getTime() > checkNowMs + REFRESH_SKEW_MS) {
      return decryptSecret(connection.encryptedAccessToken);
    }
    if (
      !operation?.pendingUntil ||
      operation.pendingUntil.getTime() <= checkNowMs
    ) {
      return getFigmaAccessToken(userId, checkNowMs);
    }
    if (checkNowMs >= waitUntilMs) return undefined;
  }
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

  const config = getFigmaOAuthConfig();
  if (!config) throw new Error("Figma OAuth is not configured");
  const operationId = newOperationId();
  const refresh = await withFigmaConnectionLock(userId, async (tx) => {
    const connection = await tx.figmaConnection.findUnique({
      where: { userId },
      select: {
        encryptedAccessToken: true,
        encryptedRefreshToken: true,
        expiresAt: true,
      },
    });
    if (!connection) return { status: "missing" } as const;
    if (connection.expiresAt.getTime() > nowMs + REFRESH_SKEW_MS) {
      return {
        status: "fresh",
        accessToken: decryptSecret(connection.encryptedAccessToken),
      } as const;
    }

    const operation = await tx.figmaConnectionOperation.findUnique({
      where: { userId },
      select: { pendingUntil: true },
    });
    if (operation?.pendingUntil && operation.pendingUntil.getTime() > nowMs) {
      return { status: "pending" } as const;
    }

    await setFigmaOperation(
      tx,
      userId,
      operationId,
      new Date(nowMs + FIGMA_OPERATION_TTL_MS),
    );
    return {
      status: "refresh",
      encryptedRefreshToken: connection.encryptedRefreshToken,
      refreshToken: decryptSecret(connection.encryptedRefreshToken),
    } as const;
  });

  if (refresh.status === "missing") return null;
  if (refresh.status === "fresh") return refresh.accessToken;
  if (refresh.status === "pending") {
    const accessToken = await waitForPendingRefresh(userId, nowMs);
    if (accessToken !== undefined) return accessToken;
    throw new Error("Figma token refresh did not finish in time");
  }

  let refreshed: FigmaToken;
  try {
    refreshed = await refreshFigmaToken(
      refresh.refreshToken,
      config,
      nowMs,
    );
  } catch (error) {
    if (
      error instanceof FigmaOAuthRequestError &&
      error.oauthError === "invalid_grant"
    ) {
      const removed = await retryFigmaPersistence(() =>
        withFigmaConnectionLock(userId, async (tx) => {
          const operation = await tx.figmaConnectionOperation.findUnique({
            where: { userId },
            select: { operationId: true },
          });
          if (operation?.operationId !== operationId) return false;

          const connection = await tx.figmaConnection.findUnique({
            where: { userId },
            select: { encryptedRefreshToken: true },
          });
          if (
            connection &&
            connection.encryptedRefreshToken !==
              refresh.encryptedRefreshToken
          ) {
            return false;
          }
          await tx.figmaConnection.deleteMany({ where: { userId } });
          await tx.figmaConnectionOperation.update({
            where: { userId },
            data: { pendingUntil: null },
          });
          return true;
        }),
      );
      if (removed) return null;
      throw new Error("Figma connection changed during token refresh");
    }

    await clearPendingOperation(userId, operationId).catch(() => {});
    throw error;
  }

  try {
    const data = {
      encryptedAccessToken: encryptSecret(refreshed.accessToken),
      encryptedRefreshToken: encryptSecret(
        refreshed.refreshToken ?? refresh.refreshToken,
      ),
      expiresAt: refreshed.expiresAt,
    };
    const accessToken = await retryFigmaPersistence(() =>
      withFigmaConnectionLock(userId, async (tx) => {
        const operation = await tx.figmaConnectionOperation.findUnique({
          where: { userId },
          select: { operationId: true },
        });
        if (operation?.operationId !== operationId) return null;

        const connection = await tx.figmaConnection.findUnique({
          where: { userId },
          select: {
            encryptedAccessToken: true,
            encryptedRefreshToken: true,
            expiresAt: true,
          },
        });
        if (!connection) return null;
        if (
          connection.encryptedAccessToken === data.encryptedAccessToken &&
          connection.encryptedRefreshToken === data.encryptedRefreshToken
        ) {
          return refreshed.accessToken;
        }
        if (
          connection.encryptedRefreshToken !== refresh.encryptedRefreshToken
        ) {
          return connection.expiresAt.getTime() > nowMs + REFRESH_SKEW_MS
            ? decryptSecret(connection.encryptedAccessToken)
            : null;
        }

        await tx.figmaConnection.update({ where: { userId }, data });
        await tx.figmaConnectionOperation.update({
          where: { userId },
          data: { pendingUntil: null },
        });
        return refreshed.accessToken;
      }),
    );
    if (!accessToken) {
      throw new Error("Figma connection changed during token refresh");
    }
    return accessToken;
  } catch (error) {
    await clearPendingOperation(userId, operationId).catch(() => {});
    throw error;
  }
}
