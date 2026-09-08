const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
let row;
let refreshError;
let updateCount = 1;
let updateWhere;

class GoogleOAuthRequestError extends Error {
  constructor(oauthError) {
    super(oauthError);
    this.oauthError = oauthError;
  }
}

function stub(file, exports) {
  const filename = path.join(root, file);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

stub("src/lib/crypto/byokCipher.ts", {
  decryptSecret: (value) => value,
  encryptSecret: (value) => value,
});
stub("src/lib/flags.ts", {
  GOOGLE_CALENDAR_FLAG: "htpr-3533-google-calendar",
  isFeatureEnabled: async () => true,
});
stub("src/lib/prisma.ts", {
  default: {
    googleCalendarConnection: {
      create: async ({ data }) => {
        row = data;
        return row;
      },
      findUnique: async () => row,
      updateMany: async ({ data, where }) => {
        updateWhere = where;
        if (updateCount === 1) Object.assign(row, data);
        return { count: updateCount };
      },
    },
  },
});
stub("src/lib/redis.ts", {
  getRedis: async () => ({
    eval: async () => 1,
    set: async () => "OK",
  }),
});
stub("src/lib/googleCalendar/client.ts", {
  createGoogleCalendar: async () => {},
  googleCalendarExists: async () => true,
  throwAfterGoogleCalendarCleanup: async (_calendarId, _accessToken, error) => {
    throw error;
  },
});
stub("src/lib/googleCalendar/oauth.ts", {
  getGoogleCalendarOAuthConfig: () => ({}),
  GoogleOAuthRequestError,
  refreshGoogleCalendarToken: async () => {
    throw refreshError;
  },
});

const connection = createJiti(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
})(path.join(root, "src/lib/googleCalendar/connection.ts"));

test("a stale disable request cannot cancel a queued disconnect", async () => {
  updateWhere = null;
  updateCount = 1;
  const disconnectRequestedAt = new Date("2026-09-08T12:00:00.000Z");
  row = {
    cleanupPending: true,
    disconnectRequestedAt,
    syncEnabled: false,
  };
  assert.equal(await connection.setGoogleCalendarSyncEnabled(6, false), true);
  assert.equal(row.disconnectRequestedAt, disconnectRequestedAt);
  assert.equal(row.cleanupPending, true);
  assert.equal(row.syncEnabled, false);
});

test("an invalid grant stops retrying until the user reconnects", async () => {
  updateWhere = null;
  updateCount = 1;
  row = {
    cleanupPending: true,
    encryptedAccessToken: "access-token",
    encryptedRefreshToken: "refresh-token",
    expiresAt: new Date(0),
    syncEnabled: true,
  };
  refreshError = new GoogleOAuthRequestError("invalid_grant");
  assert.equal(
    await connection.getGoogleCalendarAccessTokenUnlocked(6, Date.now()),
    null,
  );
  assert.equal(row.cleanupPending, true);
  assert.equal(row.syncEnabled, false);
  assert.equal(row.syncError, "Reconnect Google Calendar to resume updates.");
});

test("a stale OAuth callback cannot overwrite a changed connection", async () => {
  row = {
    calendarId: "calendar",
    calendarSummary: "Hypertask",
    encryptedAccessToken: "new-access-token",
    encryptedRefreshToken: "new-refresh-token",
    googleSubject: "google-user",
    updatedAt: new Date("2026-09-08T12:00:00.000Z"),
  };
  updateCount = 0;
  await assert.rejects(
    connection.connectGoogleCalendarUser(6, {
      accessToken: "stale-access-token",
      email: "owner@example.com",
      expiresAt: new Date("2026-09-08T14:00:00.000Z"),
      refreshToken: "stale-refresh-token",
      subject: "google-user",
    }),
    /connection changed during setup/,
  );
  assert.equal(row.encryptedAccessToken, "new-access-token");
  assert.deepEqual(updateWhere, {
    googleSubject: "google-user",
    updatedAt: new Date("2026-09-08T12:00:00.000Z"),
    userId: 6,
  });
});

test("an expired lease rejects later calendar writes", async () => {
  const originalNow = Date.now;
  let nowMs = 1_000;
  Date.now = () => nowMs;
  try {
    await assert.rejects(
      connection.withGoogleCalendarUserLock(6, async (lease) => {
        nowMs += 55_000;
        lease.assertOwned();
      }),
      connection.GoogleCalendarLockLostError,
    );
  } finally {
    Date.now = originalNow;
  }
});

test("reconnecting resumes cleanup without turning sync back on", async () => {
  updateWhere = null;
  row = {
    calendarId: "calendar",
    calendarSummary: "Hypertask",
    cleanupPending: true,
    encryptedAccessToken: "expired-access-token",
    encryptedRefreshToken: "expired-refresh-token",
    googleSubject: "google-user",
    updatedAt: new Date("2026-09-08T12:00:00.000Z"),
  };
  updateCount = 1;
  const result = await connection.connectGoogleCalendarUser(6, {
    accessToken: "new-access-token",
    email: "owner@example.com",
    expiresAt: new Date("2026-09-08T14:00:00.000Z"),
    refreshToken: "new-refresh-token",
    subject: "google-user",
  });
  assert.equal(result.syncEnabled, false);
  assert.equal(row.cleanupPending, true);
  assert.equal(row.syncEnabled, false);
});
