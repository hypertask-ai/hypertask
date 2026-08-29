-- HTPR-4869: a browser push token must belong to at most one account.
-- Production rollout: resolve ambiguous tokens first, then apply this file and
-- its Prisma ledger row in one transaction before deploying the upsert code.
ALTER TABLE "SubscribedDevices" ALTER COLUMN "firebaseId" DROP DEFAULT;

-- Ambiguous production rows must be resolved explicitly before applying this
-- migration. Never guess which account owns a shared browser token.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "SubscribedDevices" WHERE btrim("firebaseId") = ''
  ) OR EXISTS (
    SELECT 1
    FROM "SubscribedDevices"
    GROUP BY "firebaseId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'SubscribedDevices contains blank or duplicate firebaseId values';
  END IF;
END $$;

CREATE UNIQUE INDEX "SubscribedDevices_firebaseId_key"
ON "SubscribedDevices"("firebaseId");

-- HTPR-4925: support the per-agent last-posted-at lookup.
CREATE INDEX "Comment_agentId_createdAt_idx"
ON "Comment"("agentId", "createdAt");
