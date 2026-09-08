import { decryptSecret } from "@/lib/crypto/byokCipher";
import { isFeatureEnabled, GOOGLE_CALENDAR_FLAG } from "@/lib/flags";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import {
  createGoogleCalendar,
  deleteGoogleCalendar,
  deleteGoogleCalendarEvent,
  googleCalendarEventBody,
  googleCalendarEventId,
  googleCalendarTaskFingerprint,
  googleCalendarExists,
  insertGoogleCalendarEvent,
  listGoogleCalendarEvents,
  revokeGoogleToken,
  throwAfterGoogleCalendarCleanup,
  updateGoogleCalendarEvent,
  type GoogleCalendarTask,
} from "./client";
import {
  getGoogleCalendarAccessTokenUnlocked,
  GoogleCalendarLockLostError,
  type GoogleCalendarLease,
  withGoogleCalendarUserLock,
} from "./connection";

// ponytail: one connection keeps the shared minute sweep within its lease while
// this flag serves Owner + QA. Move calendar work to its own queue before Everyone.
const CONNECTIONS_PER_SWEEP = 1;
const CONNECTION_CANDIDATES_PER_SWEEP = 20;
const MAX_TASKS_PER_CALENDAR = 10_000;
const OPERATIONS_PER_CONNECTION = 20;
const RETRYABLE_SYNC_ERROR = "Calendar updates failed. Hypertask will retry.";

class GoogleCalendarSyncPausedError extends Error {}

async function runGoogleCalendarOperations(
  operations: Array<() => Promise<void>>,
): Promise<void> {
  const results = await Promise.allSettled(
    operations.map((operation) => operation()),
  );
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure) throw failure.reason;
}

async function revokeAndDeleteDisconnectedConnection(
  connection: {
    disconnectRequestedAt: Date;
    encryptedRefreshToken: string;
    userId: number;
  },
  lease: GoogleCalendarLease,
): Promise<void> {
  try {
    await revokeGoogleToken(decryptSecret(connection.encryptedRefreshToken));
  } catch (error) {
    console.error("Google Calendar token revocation failed", error);
    lease.assertOwned();
    await prisma.googleCalendarConnection.updateMany({
      where: {
        userId: connection.userId,
        disconnectRequestedAt: { equals: connection.disconnectRequestedAt },
        encryptedRefreshToken: connection.encryptedRefreshToken,
      },
      data: { syncError: "Google disconnect failed. Hypertask will retry." },
    });
    return;
  }
  lease.assertOwned();
  await prisma.googleCalendarConnection.deleteMany({
    where: {
      userId: connection.userId,
      disconnectRequestedAt: { equals: connection.disconnectRequestedAt },
      encryptedRefreshToken: connection.encryptedRefreshToken,
    },
  });
}

async function finishDisconnect(
  connection: {
    calendarId: string;
    disconnectRequestedAt: Date;
    encryptedRefreshToken: string;
    userId: number;
  },
  accessToken: string,
  lease: GoogleCalendarLease,
): Promise<void> {
  const remaining = await listGoogleCalendarEvents(
    connection.calendarId,
    accessToken,
    false,
    fetch,
    lease.assertOwned,
  );
  lease.assertOwned();
  if (remaining.every((event) => event.status === "cancelled")) {
    await deleteGoogleCalendar(connection.calendarId, accessToken);
    lease.assertOwned();
  }
  await revokeAndDeleteDisconnectedConnection(connection, lease);
}

async function cleanupConnection(
  connection: {
    calendarId: string;
    disconnectRequestedAt: Date | null;
    encryptedRefreshToken: string;
    userId: number;
  },
  accessToken: string,
  lease: GoogleCalendarLease,
): Promise<void> {
  const managed = await listGoogleCalendarEvents(
    connection.calendarId,
    accessToken,
    true,
    fetch,
    lease.assertOwned,
  );
  const batch = managed
    .filter((event): event is typeof event & { id: string } =>
      Boolean(event.id),
    )
    .slice(0, OPERATIONS_PER_CONNECTION);
  await runGoogleCalendarOperations(
    batch.map((event) => async () => {
      lease.assertOwned();
      await deleteGoogleCalendarEvent(
        connection.calendarId,
        accessToken,
        event.id,
      );
      lease.assertOwned();
    }),
  );
  lease.assertOwned();
  const managedWithIds = managed.filter((event) => Boolean(event.id));
  if (managedWithIds.length > batch.length) {
    await prisma.googleCalendarConnection.updateMany({
      where: { userId: connection.userId },
      data: { syncError: null },
    });
    return;
  }
  const disconnectRequestedAt = connection.disconnectRequestedAt;
  if (disconnectRequestedAt) {
    await finishDisconnect(
      { ...connection, disconnectRequestedAt },
      accessToken,
      lease,
    );
    return;
  }
  await prisma.googleCalendarConnection.updateMany({
    where: { userId: connection.userId, disconnectRequestedAt: null },
    data: { cleanupPending: false, lastSyncedAt: new Date(), syncError: null },
  });
}

async function loadDesiredTasks(
  userId: number,
  lease: GoogleCalendarLease,
): Promise<GoogleCalendarTask[]> {
  const tasks: GoogleCalendarTask[] = [];
  let cursor: number | undefined;
  while (true) {
    const page = await prisma.task.findMany({
      where: {
        assignees: { some: { userId, agentId: null } },
        dueDate: { not: null },
        project: { is: getProjectWhere(userId) },
        status: "Normal",
      },
      orderBy: { id: "asc" },
      take: 1000,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        dueDate: true,
        id: true,
        projectId: true,
        section: true,
        ticketNumber: true,
        title: true,
        uniqueIndex: true,
      },
    });
    lease.assertOwned();
    tasks.push(
      ...page.filter(
        (task): task is typeof task & { dueDate: Date } =>
          task.dueDate !== null,
      ),
    );
    if (tasks.length > MAX_TASKS_PER_CALENDAR) {
      throw new GoogleCalendarSyncPausedError(
        "Calendar updates paused because more than 10,000 tasks have due dates.",
      );
    }
    if (page.length < 1000) return tasks;
    cursor = page[page.length - 1]?.id;
    if (!cursor) return tasks;
  }
}

async function syncConnection(
  connection: { calendarId: string; userId: number },
  accessToken: string,
  lease: GoogleCalendarLease,
): Promise<void> {
  const [desiredTasks, remoteEvents] = await Promise.all([
    loadDesiredTasks(connection.userId, lease),
    listGoogleCalendarEvents(
      connection.calendarId,
      accessToken,
      true,
      fetch,
      lease.assertOwned,
    ),
  ]);
  lease.assertOwned();
  const desired = new Map(
    desiredTasks.map((task) => [googleCalendarEventId(task.id), task]),
  );
  const remote = new Map(
    remoteEvents
      .filter((event): event is typeof event & { id: string } =>
        Boolean(event.id),
      )
      .map((event) => [event.id, event]),
  );
  const operations: Array<() => Promise<void>> = [];

  for (const [eventId, task] of desired) {
    const event = remote.get(eventId);
    const fingerprint = event?.extendedProperties?.private?.fingerprint;
    if (!event) {
      operations.push(async () => {
        lease.assertOwned();
        await insertGoogleCalendarEvent(
          connection.calendarId,
          accessToken,
          googleCalendarEventBody(task),
        );
        lease.assertOwned();
      });
    } else if (fingerprint !== googleCalendarTaskFingerprint(task)) {
      operations.push(async () => {
        lease.assertOwned();
        await updateGoogleCalendarEvent(
          connection.calendarId,
          accessToken,
          googleCalendarEventBody(task),
        );
        lease.assertOwned();
      });
    }
  }
  for (const eventId of remote.keys()) {
    if (!desired.has(eventId)) {
      operations.push(async () => {
        lease.assertOwned();
        await deleteGoogleCalendarEvent(
          connection.calendarId,
          accessToken,
          eventId,
        );
        lease.assertOwned();
      });
    }
  }

  await runGoogleCalendarOperations(
    operations.slice(0, OPERATIONS_PER_CONNECTION),
  );
  lease.assertOwned();
  await prisma.googleCalendarConnection.updateMany({
    where: {
      userId: connection.userId,
      syncEnabled: true,
      cleanupPending: false,
    },
    data:
      operations.length <= OPERATIONS_PER_CONNECTION
        ? { lastSyncedAt: new Date(), syncError: null }
        : { syncError: null },
  });
}

async function processConnection(userId: number): Promise<boolean> {
  const result = await withGoogleCalendarUserLock(
    userId,
    async (lease) => {
      try {
        let connection = await prisma.googleCalendarConnection.findUnique({
          where: { userId },
        });
        lease.assertOwned();
        if (!connection) return true;
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true },
        });
        lease.assertOwned();
        if (!user && !connection.disconnectRequestedAt) {
          connection = await prisma.googleCalendarConnection.update({
            where: { userId },
            data: {
              cleanupPending: true,
              disconnectRequestedAt: new Date(),
              syncEnabled: false,
            },
          });
        }
        if (
          connection.syncEnabled &&
          !(await isFeatureEnabled(GOOGLE_CALENDAR_FLAG, userId))
        ) {
          lease.assertOwned();
          await prisma.googleCalendarConnection.update({
            where: { userId },
            data: { cleanupPending: true, syncEnabled: false },
          });
        }
        const accessToken = await getGoogleCalendarAccessTokenUnlocked(
          userId,
          Date.now(),
          lease.assertOwned,
        );
        const refreshedConnection =
          await prisma.googleCalendarConnection.findUnique({
            where: { userId },
          });
        lease.assertOwned();
        if (!refreshedConnection) return true;
        connection = refreshedConnection;
        if (!accessToken) {
          const disconnectRequestedAt = connection.disconnectRequestedAt;
          if (disconnectRequestedAt) {
            await revokeAndDeleteDisconnectedConnection(
              { ...connection, disconnectRequestedAt },
              lease,
            );
          }
          return true;
        }
        const exists = await googleCalendarExists(
          connection.calendarId,
          accessToken,
        );
        lease.assertOwned();
        if (!exists) {
          const disconnectRequestedAt = connection.disconnectRequestedAt;
          if (disconnectRequestedAt) {
            await revokeAndDeleteDisconnectedConnection(
              { ...connection, disconnectRequestedAt },
              lease,
            );
            return true;
          }
          if (connection.cleanupPending) {
            lease.assertOwned();
            await prisma.googleCalendarConnection.update({
              where: { userId },
              data: {
                cleanupPending: false,
                lastSyncedAt: new Date(),
                syncError: null,
              },
            });
            return true;
          }
          const calendar = await createGoogleCalendar(accessToken);
          try {
            lease.assertOwned();
            connection = await prisma.googleCalendarConnection.update({
              where: { userId },
              data: {
                calendarId: calendar.id,
                calendarSummary: calendar.summary,
              },
            });
          } catch (error) {
            await throwAfterGoogleCalendarCleanup(
              calendar.id,
              accessToken,
              error,
            );
          }
        }
        if (connection.cleanupPending || connection.disconnectRequestedAt) {
          await cleanupConnection(connection, accessToken, lease);
        } else if (connection.syncEnabled) {
          await syncConnection(connection, accessToken, lease);
        }
        return true;
      } catch (error) {
        console.error("Google Calendar sync failed", userId, error);
        if (error instanceof GoogleCalendarLockLostError) throw error;
        lease.assertOwned();
        await prisma.googleCalendarConnection.updateMany({
          where: { userId },
          data:
            error instanceof GoogleCalendarSyncPausedError
              ? { syncEnabled: false, syncError: error.message }
              : {
                  syncError: RETRYABLE_SYNC_ERROR,
                },
        });
        return false;
      }
    },
    false,
  );
  return result === true;
}

export async function sweepGoogleCalendarConnections(): Promise<number> {
  const connections = await prisma.googleCalendarConnection.findMany({
    where: {
      OR: [
        { disconnectRequestedAt: { not: null } },
        { cleanupPending: true, syncError: null },
        { cleanupPending: true, syncError: RETRYABLE_SYNC_ERROR },
        { syncEnabled: true },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: CONNECTION_CANDIDATES_PER_SWEEP,
    select: { userId: true },
  });
  let processed = 0;
  for (const connection of connections) {
    try {
      if (await processConnection(connection.userId)) {
        processed += 1;
        if (processed >= CONNECTIONS_PER_SWEEP) break;
      }
    } catch (error) {
      console.error("Google Calendar sync failed", connection.userId, error);
    }
  }
  return processed;
}
