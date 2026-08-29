-- HTPR-5656: identify each lease instance so an adopted-lease release can
-- verify it deletes the lease it created. Explicit claims stay null.
ALTER TABLE "TaskLease" ADD COLUMN "token" TEXT;
