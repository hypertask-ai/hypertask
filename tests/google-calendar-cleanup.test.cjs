const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
let connection;
let deletedCalendar;
let deletedCalendarId;
let deletedEvents;
let revokedToken;
let accessToken;
let managedEvents;
let remainingEvents;
let taskPages;
let rotatedRefreshToken;
let calendarExists;
let updateError;
let updateManyData;
let userExists;
let revokeError;
let listError;
let failingEventId;
let delayedEventId;
let releaseDelayedEvent;
let delayedEventFinished;
let insertedEvents;
let updatedEvents;

function stub(file, exports) {
  const filename = path.join(root, file);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

const googleCalendarConnection = {
  async findMany({ where }) {
    if (!connection) return [];
    const matches = where.OR.some((condition) => {
      if (condition.disconnectRequestedAt) {
        return connection.disconnectRequestedAt !== null;
      }
      if (condition.cleanupPending !== undefined) {
        return (
          connection.cleanupPending === condition.cleanupPending &&
          connection.syncError === condition.syncError
        );
      }
      if (condition.syncEnabled !== undefined) {
        return connection.syncEnabled === condition.syncEnabled;
      }
      return false;
    });
    return matches ? [{ userId: connection.userId }] : [];
  },
  async findUnique() {
    return connection;
  },
  async updateMany({ data }) {
    updateManyData.push(data);
    if (connection) Object.assign(connection, data);
    return { count: connection ? 1 : 0 };
  },
  async update({ data }) {
    if (updateError) throw updateError;
    Object.assign(connection, data);
    return connection;
  },
  async delete() {
    connection = null;
  },
  async deleteMany() {
    connection = null;
    return { count: 1 };
  },
};

stub("src/lib/prisma.ts", {
  default: {
    googleCalendarConnection,
    user: { findUnique: async () => (userExists ? { id: 6 } : null) },
    task: { findMany: async () => taskPages.shift() ?? [] },
  },
});
stub("src/lib/crypto/byokCipher.ts", {
  decryptSecret: (value) =>
    value === "rotated" ? "rotated-refresh-token" : "refresh-token",
});
stub("src/lib/flags.ts", {
  GOOGLE_CALENDAR_FLAG: "htpr-3533-google-calendar",
  isFeatureEnabled: async () => true,
});
stub("src/utils/controllers/projects/getAllIncludes.ts", {
  getProjectWhere: () => ({}),
});
stub("src/lib/googleCalendar/connection.ts", {
  getGoogleCalendarAccessTokenUnlocked: async () => {
    if (rotatedRefreshToken) connection.encryptedRefreshToken = "rotated";
    return accessToken;
  },
  GoogleCalendarLockLostError: class extends Error {},
  withGoogleCalendarUserLock: async (_userId, action) =>
    action({ assertOwned: () => {} }),
});
stub("src/lib/googleCalendar/client.ts", {
  createGoogleCalendar: async () => ({
    id: "new-calendar",
    summary: "Hypertask",
  }),
  deleteGoogleCalendar: async (calendarId) => {
    deletedCalendar = true;
    deletedCalendarId = calendarId;
  },
  deleteGoogleCalendarEvent: async (_calendarId, _accessToken, eventId) => {
    if (eventId === failingEventId) throw new Error("Google unavailable");
    if (eventId === delayedEventId) {
      await new Promise((resolve) => {
        releaseDelayedEvent = resolve;
      });
      delayedEventFinished = true;
    }
    deletedEvents.push(eventId);
  },
  googleCalendarEventBody: () => ({}),
  googleCalendarEventId: (id) => `htask${id}`,
  googleCalendarTaskFingerprint: () => "fingerprint",
  googleCalendarExists: async () => calendarExists,
  insertGoogleCalendarEvent: async (...args) => {
    insertedEvents.push(args);
  },
  listGoogleCalendarEvents: async (_calendarId, _accessToken, managedOnly) => {
    if (listError) throw listError;
    return managedOnly ? managedEvents : remainingEvents;
  },
  revokeGoogleToken: async (token) => {
    if (revokeError) throw revokeError;
    revokedToken = token;
  },
  throwAfterGoogleCalendarCleanup: async (calendarId, _accessToken, error) => {
    deletedCalendar = true;
    deletedCalendarId = calendarId;
    throw error;
  },
  updateGoogleCalendarEvent: async (...args) => {
    updatedEvents.push(args);
  },
});

const sync = createJiti(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
})(path.join(root, "src/lib/googleCalendar/sync.ts"));

test.beforeEach(() => {
  connection = {
    calendarId: "calendar",
    calendarSummary: "Hypertask",
    cleanupPending: true,
    disconnectRequestedAt: new Date(),
    encryptedRefreshToken: "encrypted",
    syncEnabled: false,
    syncError: null,
    userId: 6,
  };
  deletedCalendar = false;
  deletedCalendarId = null;
  deletedEvents = [];
  revokedToken = null;
  accessToken = "access-token";
  managedEvents = [
    { id: "htask1", extendedProperties: { private: { hypertask: "1" } } },
  ];
  remainingEvents = [{ id: "personal-event" }];
  taskPages = [[]];
  rotatedRefreshToken = false;
  calendarExists = true;
  updateError = null;
  updateManyData = [];
  userExists = true;
  revokeError = null;
  listError = null;
  failingEventId = null;
  delayedEventId = null;
  releaseDelayedEvent = null;
  delayedEventFinished = false;
  insertedEvents = [];
  updatedEvents = [];
});

test("safe disconnect removes managed events but preserves a calendar with personal events", async () => {
  assert.equal(await sync.sweepGoogleCalendarConnections(), 1);
  assert.deepEqual(deletedEvents, ["htask1"]);
  assert.equal(deletedCalendar, false);
  assert.equal(revokedToken, "refresh-token");
  assert.equal(connection, null);
});

test("reconciliation loads every desired task before removing remote events", async () => {
  connection.cleanupPending = false;
  connection.disconnectRequestedAt = null;
  connection.syncEnabled = true;
  const task = (id) => ({
    dueDate: new Date("2026-09-08T12:00:00.000Z"),
    id,
    projectId: 15,
    section: "Features",
    ticketNumber: `HTPR-${id}`,
    title: `Task ${id}`,
    uniqueIndex: id,
  });
  taskPages = [
    Array.from({ length: 1000 }, (_, index) => task(index + 1)),
    [task(1001)],
  ];
  managedEvents = [
    {
      id: "htask1001",
      extendedProperties: {
        private: { fingerprint: "fingerprint", hypertask: "1" },
      },
    },
  ];
  assert.equal(await sync.sweepGoogleCalendarConnections(), 1);
  assert.deepEqual(deletedEvents, []);
  assert.equal(taskPages.length, 0);
  assert.equal(connection.lastSyncedAt, undefined);
});

test("reconciliation restores a cancelled task event", async () => {
  connection.cleanupPending = false;
  connection.disconnectRequestedAt = null;
  connection.syncEnabled = true;
  taskPages = [
    [
      {
        dueDate: new Date("2026-09-08T12:00:00.000Z"),
        id: 1,
        projectId: 15,
        section: "Features",
        ticketNumber: "HTPR-1",
        title: "Task 1",
        uniqueIndex: 1,
      },
    ],
  ];
  managedEvents = [
    {
      id: "htask1",
      status: "cancelled",
      extendedProperties: {
        private: { fingerprint: "fingerprint", hypertask: "1" },
      },
    },
  ];

  assert.equal(await sync.sweepGoogleCalendarConnections(), 1);
  assert.equal(insertedEvents.length, 0);
  assert.equal(updatedEvents.length, 1);
});

test("partial cleanup yields to other connections after one bounded batch", async () => {
  connection.disconnectRequestedAt = null;
  managedEvents = Array.from({ length: 21 }, (_, index) => ({
    id: `htask${index + 1}`,
  }));
  assert.equal(await sync.sweepGoogleCalendarConnections(), 1);
  assert.equal(deletedEvents.length, 20);
  assert.deepEqual(updateManyData.at(-1), { syncError: null });
  assert.equal(connection.cleanupPending, true);
});

test("a failed replacement-calendar save deletes the new remote calendar", async () => {
  connection.cleanupPending = false;
  connection.disconnectRequestedAt = null;
  connection.syncEnabled = true;
  calendarExists = false;
  updateError = new Error("database unavailable");
  assert.equal(await sync.sweepGoogleCalendarConnections(), 0);
  assert.equal(deletedCalendar, true);
  assert.equal(deletedCalendarId, "new-calendar");
  assert.equal(connection.calendarId, "calendar");
});

test("disconnect clears a dead local grant when Google cannot authorize cleanup", async () => {
  accessToken = null;
  assert.equal(await sync.sweepGoogleCalendarConnections(), 1);
  assert.deepEqual(deletedEvents, []);
  assert.equal(deletedCalendar, false);
  assert.equal(revokedToken, "refresh-token");
  assert.equal(connection, null);
});

test("disconnect revokes a refresh token rotated during access-token renewal", async () => {
  rotatedRefreshToken = true;
  assert.equal(await sync.sweepGoogleCalendarConnections(), 1);
  assert.equal(revokedToken, "rotated-refresh-token");
  assert.equal(connection, null);
});

test("a deleted user triggers remote calendar cleanup", async () => {
  connection.cleanupPending = false;
  connection.disconnectRequestedAt = null;
  connection.syncEnabled = true;
  userExists = false;
  assert.equal(await sync.sweepGoogleCalendarConnections(), 1);
  assert.deepEqual(deletedEvents, ["htask1"]);
  assert.equal(connection, null);
});

test("disconnect retries when Google token revocation fails", async () => {
  revokeError = new Error("Google unavailable");
  assert.equal(await sync.sweepGoogleCalendarConnections(), 1);
  assert.deepEqual(deletedEvents, ["htask1"]);
  assert.notEqual(connection, null);
  assert.equal(
    connection.syncError,
    "Google disconnect failed. Hypertask will retry.",
  );
});

test("task capacity errors pause retries until the user intervenes", async () => {
  connection.cleanupPending = false;
  connection.disconnectRequestedAt = null;
  connection.syncEnabled = true;
  const task = (id) => ({
    dueDate: new Date("2026-09-08T12:00:00.000Z"),
    id,
    projectId: 15,
    section: "Features",
    ticketNumber: `HTPR-${id}`,
    title: `Task ${id}`,
    uniqueIndex: id,
  });
  taskPages = Array.from({ length: 10 }, (_, page) =>
    Array.from({ length: 1000 }, (_, index) => task(page * 1000 + index + 1)),
  );
  taskPages.push([task(10_001)]);
  managedEvents = [];
  assert.equal(await sync.sweepGoogleCalendarConnections(), 0);
  assert.equal(connection.syncEnabled, false);
  assert.match(connection.syncError, /more than 10,000 tasks/);
  assert.equal(await sync.sweepGoogleCalendarConnections(), 0);
});

test("transient sync errors remain eligible for a later sweep", async () => {
  connection.cleanupPending = false;
  connection.disconnectRequestedAt = null;
  connection.syncEnabled = true;
  listError = new Error("Google unavailable");
  assert.equal(await sync.sweepGoogleCalendarConnections(), 0);
  assert.equal(
    connection.syncError,
    "Calendar updates failed. Hypertask will retry.",
  );

  listError = null;
  assert.equal(await sync.sweepGoogleCalendarConnections(), 1);
  assert.equal(connection.syncError, null);
});

test("transient cleanup errors remain eligible for a later sweep", async () => {
  connection.disconnectRequestedAt = null;
  listError = new Error("Google unavailable");
  assert.equal(await sync.sweepGoogleCalendarConnections(), 0);
  assert.equal(
    connection.syncError,
    "Calendar updates failed. Hypertask will retry.",
  );

  listError = null;
  assert.equal(await sync.sweepGoogleCalendarConnections(), 1);
  assert.equal(connection.cleanupPending, false);
  assert.equal(connection.syncError, null);
});

test("cleanup waits for every started Google request before releasing its lock", async () => {
  connection.disconnectRequestedAt = null;
  managedEvents = [{ id: "htask1" }, { id: "htask2" }];
  failingEventId = "htask1";
  delayedEventId = "htask2";

  let sweepFinished = false;
  const sweep = sync.sweepGoogleCalendarConnections().then((result) => {
    sweepFinished = true;
    return result;
  });
  await new Promise(setImmediate);
  assert.equal(sweepFinished, false);
  assert.equal(typeof releaseDelayedEvent, "function");

  releaseDelayedEvent();
  assert.equal(await sweep, 0);
  assert.equal(delayedEventFinished, true);
});
