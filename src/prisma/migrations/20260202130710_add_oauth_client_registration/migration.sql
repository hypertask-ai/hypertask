/*
  Warnings:

  - You are about to alter the column `client_id` on the `OAuthAuthorizationCode` table. The data in that column could be lost. The data in that column will be cast from `VarChar(255)` to `VarChar(64)`.

*/
-- AlterTable
ALTER TABLE "OAuthAuthorizationCode" ALTER COLUMN "client_id" SET DATA TYPE VARCHAR(64);

-- CreateTable
CREATE TABLE "OAuthClient" (
    "client_id" VARCHAR(64) NOT NULL,
    "client_name" TEXT,
    "redirect_uris" JSONB NOT NULL,
    "grant_types" JSONB NOT NULL DEFAULT '["authorization_code"]',
    "token_endpoint_auth_method" TEXT NOT NULL DEFAULT 'none',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthClient_pkey" PRIMARY KEY ("client_id")
);

-- CreateIndex
CREATE INDEX "OAuthClient_client_id_idx" ON "OAuthClient"("client_id");

-- CreateIndex
CREATE INDEX "OAuthAuthorizationCode_client_id_idx" ON "OAuthAuthorizationCode"("client_id");

-- AddForeignKey
ALTER TABLE "OAuthAuthorizationCode" ADD CONSTRAINT "OAuthAuthorizationCode_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "OAuthClient"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;
