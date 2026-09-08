import { randomBytes } from "node:crypto";

import { decryptSecret, encryptSecret } from "@/lib/crypto/byokCipher";
import { GOOGLE_CALENDAR_FLAG, isFeatureEnabled } from "@/lib/flags";
import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import {
  createGoogleCalendar,
  googleCalendarExists,
  throwAfterGoogleCalendarCleanup,
} from "./client";
import {
  getGoogleCalendarOAuthConfig,
  GoogleOAuthRequestError,
  refreshGoogleCalendarToken,
  type GoogleCalendarToken,
  type GoogleIdentity,
} from "./oauth";

const LOCK_TTL_MS = 55_000;
const LOCK_RENEW_INTERVAL_MS = 10_000;
const LOCK_RENEW_TIMEOUT_MS = 5_000;
const REFRESH_SKEW_MS = 60_000;

export type GoogleAuthorization = GoogleCalendarToken &
  GoogleIdentity & { refreshToken?: string };

export class GoogleAccountMismatchError extends Error {}
export class GoogleCalendarLockLostError extends Error {}

export type GoogleCalendarLease = {
  assertOwned: () => void;
};

export const googleCalendarEnabledFor = (userId: number) =>
  isFeatureEnabled(GOOGLE_CALENDAR_FLAG, userId);

async function releaseLock(key: string, value: string): Promise<void> {
  const redis = await getRedis();
  await redis.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    1,
    key,
    value,
  );
}

export async function withGoogleCalendarUserLock<T>(
  userId: number,
  action: (lease: GoogleCalendarLease) => Promise<T>,
  wait = true,
): Promise<T | undefined> {
  const redis = await getRedis();
  const key = `google-calendar:lock:${userId}`;
  const value = randomBytes(16).toString("base64url");
  const deadline = Date.now() + (wait ? 5000 : 0);
  while (true) {
    const acquired = await redis.set(key, value, "PX", LOCK_TTL_MS, "NX");
    if (acquired === "OK") break;
    if (Date.now() >= deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  let lost = false;
  let renewing = false;
  let confirmedUntilMs = Date.now() + LOCK_TTL_MS;
  const assertOwned = () => {
    if (lost || Date.now() >= confirmedUntilMs) {
      lost = true;
      throw new GoogleCalendarLockLostError();
    }
  };
  const renew = setInterval(() => {
    if (renewing || lost) return;
    renewing = true;
    const timeout = setTimeout(() => {
      lost = true;
    }, LOCK_RENEW_TIMEOUT_MS);
    timeout.unref();
    void redis
      .eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
        1,
        key,
        value,
        String(LOCK_TTL_MS),
      )
      .then((renewed) => {
        if (Number(renewed) !== 1) lost = true;
        else if (!lost) confirmedUntilMs = Date.now() + LOCK_TTL_MS;
      })
      .catch(() => {
        lost = true;
      })
      .finally(() => {
        clearTimeout(timeout);
        renewing = false;
      });
  }, LOCK_RENEW_INTERVAL_MS);
  renew.unref();
  try {
    const result = await action({ assertOwned });
    assertOwned();
    return result;
  } finally {
    clearInterval(renew);
    await releaseLock(key, value).catch(() => {});
  }
}

export async function getGoogleCalendarAccessTokenUnlocked(
  userId: number,
  nowMs = Date.now(),
  assertOwned: () => void = () => {},
): Promise<string | null> {
  const connection = await prisma.googleCalendarConnection.findUnique({
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
  const config = getGoogleCalendarOAuthConfig();
  if (!config) throw new Error("Google Calendar OAuth is not configured");
  const encryptedRefreshToken = connection.encryptedRefreshToken;
  const refreshToken = decryptSecret(encryptedRefreshToken);
  try {
    const refreshed = await refreshGoogleCalendarToken(
      refreshToken,
      config,
      nowMs,
    );
    assertOwned();
    const updated = await prisma.googleCalendarConnection.updateMany({
      where: { userId, encryptedRefreshToken },
      data: {
        encryptedAccessToken: encryptSecret(refreshed.accessToken),
        encryptedRefreshToken: encryptSecret(
          refreshed.refreshToken ?? refreshToken,
        ),
        expiresAt: refreshed.expiresAt,
        syncError: null,
      },
    });
    if (updated.count !== 1)
      throw new Error("Google Calendar connection changed during refresh");
    return refreshed.accessToken;
  } catch (error) {
    if (
      error instanceof GoogleOAuthRequestError &&
      error.oauthError === "invalid_grant"
    ) {
      assertOwned();
      await prisma.googleCalendarConnection.updateMany({
        where: { userId, encryptedRefreshToken },
        data: {
          syncEnabled: false,
          syncError: "Reconnect Google Calendar to resume updates.",
        },
      });
      return null;
    }
    throw error;
  }
}

export function getGoogleCalendarConnection(userId: number) {
  return prisma.googleCalendarConnection.findUnique({
    where: { userId },
    select: {
      calendarSummary: true,
      cleanupPending: true,
      disconnectRequestedAt: true,
      googleEmail: true,
      lastSyncedAt: true,
      syncEnabled: true,
      syncError: true,
    },
  });
}

export async function connectGoogleCalendarUser(
  userId: number,
  authorization: GoogleAuthorization,
) {
  const result = await withGoogleCalendarUserLock(userId, async (lease) => {
    const existing = await prisma.googleCalendarConnection.findUnique({
      where: { userId },
    });
    lease.assertOwned();
    if (existing && existing.googleSubject !== authorization.subject) {
      throw new GoogleAccountMismatchError();
    }
    let refreshToken = authorization.refreshToken ?? null;
    if (!refreshToken && existing) {
      refreshToken = decryptSecret(existing.encryptedRefreshToken);
    }
    if (!refreshToken) throw new Error("Google did not return offline access");

    let calendar = existing
      ? { id: existing.calendarId, summary: existing.calendarSummary }
      : null;
    let createdCalendar = false;
    if (
      !calendar ||
      !(await googleCalendarExists(calendar.id, authorization.accessToken))
    ) {
      lease.assertOwned();
      calendar = await createGoogleCalendar(authorization.accessToken);
      createdCalendar = true;
    }
    try {
      lease.assertOwned();
      const connectionData = {
        calendarId: calendar.id,
        calendarSummary: calendar.summary,
        cleanupPending: existing?.cleanupPending ?? false,
        disconnectRequestedAt: null,
        encryptedAccessToken: encryptSecret(authorization.accessToken),
        encryptedRefreshToken: encryptSecret(refreshToken),
        expiresAt: authorization.expiresAt,
        googleEmail: authorization.email,
        googleSubject: authorization.subject,
        syncEnabled: existing ? !existing.cleanupPending : true,
        syncError: null,
      };
      if (existing) {
        const updated = await prisma.googleCalendarConnection.updateMany({
          where: {
            userId,
            googleSubject: existing.googleSubject,
            updatedAt: existing.updatedAt,
          },
          data: connectionData,
        });
        if (updated.count !== 1) {
          throw new Error("Google Calendar connection changed during setup");
        }
      } else {
        await prisma.googleCalendarConnection.create({
          data: {
            ...connectionData,
            userId,
          },
        });
      }
      return {
        calendarSummary: calendar.summary,
        googleEmail: authorization.email,
        syncEnabled: connectionData.syncEnabled,
      };
    } catch (error) {
      if (createdCalendar) {
        return throwAfterGoogleCalendarCleanup(
          calendar.id,
          authorization.accessToken,
          error,
        );
      }
      throw error;
    }
  });
  if (!result) throw new Error("Google Calendar connection is busy");
  return result;
}

export async function setGoogleCalendarSyncEnabled(
  userId: number,
  syncEnabled: boolean,
): Promise<boolean> {
  const result = await withGoogleCalendarUserLock(userId, async (lease) => {
    lease.assertOwned();
    const updated = await prisma.googleCalendarConnection.updateMany({
      where: { userId },
      data: syncEnabled
        ? {
            cleanupPending: false,
            disconnectRequestedAt: null,
            syncEnabled: true,
            syncError: null,
          }
        : {
            cleanupPending: true,
            syncEnabled: false,
            syncError: null,
          },
    });
    return updated.count === 1;
  });
  if (result === undefined)
    throw new Error("Google Calendar connection is busy");
  return result;
}

export async function requestGoogleCalendarDisconnect(
  userId: number,
): Promise<boolean> {
  const result = await withGoogleCalendarUserLock(userId, async (lease) => {
    lease.assertOwned();
    const updated = await prisma.googleCalendarConnection.updateMany({
      where: { userId },
      data: {
        cleanupPending: true,
        disconnectRequestedAt: new Date(),
        syncEnabled: false,
        syncError: null,
      },
    });
    return updated.count === 1;
  });
  if (result === undefined)
    throw new Error("Google Calendar connection is busy");
  return result;
}
