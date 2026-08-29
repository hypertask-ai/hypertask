-- CreateTable
CREATE TABLE "OAuthAuthorizationCode" (
    "code" VARCHAR(64) NOT NULL,
    "client_id" VARCHAR(255) NOT NULL,
    "redirect_uri" VARCHAR(512) NOT NULL,
    "code_challenge" VARCHAR(128) NOT NULL,
    "firebase_uid" VARCHAR(128) NOT NULL,
    "user_id" INTEGER NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthAuthorizationCode_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "OAuthAuthorizationCode_code_idx" ON "OAuthAuthorizationCode"("code");

-- CreateIndex
CREATE INDEX "OAuthAuthorizationCode_expires_at_idx" ON "OAuthAuthorizationCode"("expires_at");

-- CreateIndex
CREATE INDEX "OAuthAuthorizationCode_used_idx" ON "OAuthAuthorizationCode"("used");

-- CreateIndex
CREATE INDEX "OAuthAuthorizationCode_user_id_idx" ON "OAuthAuthorizationCode"("user_id");

-- AddForeignKey
ALTER TABLE "OAuthAuthorizationCode" ADD CONSTRAINT "OAuthAuthorizationCode_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
