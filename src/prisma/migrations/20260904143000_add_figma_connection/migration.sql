CREATE TABLE "FigmaConnection" (
    "userId" INTEGER NOT NULL,
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "figmaUserId" TEXT NOT NULL,
    "figmaUserName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FigmaConnection_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "FigmaConnection"
ADD CONSTRAINT "FigmaConnection_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "FeatureFlag" ("key", "mode", "updatedAt")
VALUES ('htpr-6136-figma-connect', 'OWNER_ONLY', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
