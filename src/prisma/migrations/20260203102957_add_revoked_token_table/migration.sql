-- CreateTable
CREATE TABLE "RevokedToken" (
    "jti" VARCHAR(255) NOT NULL,
    "user_id" INTEGER NOT NULL,
    "revoked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RevokedToken_pkey" PRIMARY KEY ("jti")
);

-- CreateIndex
CREATE INDEX "RevokedToken_user_id_idx" ON "RevokedToken"("user_id");

-- CreateIndex
CREATE INDEX "RevokedToken_revoked_at_idx" ON "RevokedToken"("revoked_at");

-- CreateIndex
CREATE INDEX "RevokedToken_expires_at_idx" ON "RevokedToken"("expires_at");

-- AddForeignKey
ALTER TABLE "RevokedToken" ADD CONSTRAINT "RevokedToken_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
