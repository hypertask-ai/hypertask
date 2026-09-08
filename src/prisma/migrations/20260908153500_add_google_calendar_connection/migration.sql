CREATE TABLE "GoogleCalendarConnection" (
    "userId" INTEGER NOT NULL,
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "googleSubject" TEXT NOT NULL,
    "googleEmail" TEXT,
    "calendarId" TEXT NOT NULL,
    "calendarSummary" TEXT NOT NULL DEFAULT 'Hypertask',
    "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "cleanupPending" BOOLEAN NOT NULL DEFAULT false,
    "disconnectRequestedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "syncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleCalendarConnection_pkey" PRIMARY KEY ("userId")
);

CREATE INDEX "GoogleCalendarConnection_cleanupPending_syncEnabled_updated_idx"
ON "GoogleCalendarConnection"("cleanupPending", "syncEnabled", "updatedAt");

-- userId intentionally has no foreign key. Deleting a user must not erase the
-- encrypted grant before the minute sweep revokes it and removes remote data.
INSERT INTO "FeatureFlag" ("key", "mode", "updatedAt")
VALUES ('htpr-3533-google-calendar', 'OWNER_AND_QA', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
