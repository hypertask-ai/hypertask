-- HTPR-8977: the two heaviest statements match "Task"."ticketNumber" with
-- ILIKE, which the plain ticket number index cannot serve, so every call
-- scanned the whole Task table. The personal log lookup scanned all of Logs.
--
-- Like 20261017120000_yper4_422_guest_cleanup_delete_indexes, run outside an
-- explicit transaction: Prisma's PostgreSQL migrate deploy does not wrap this file.
-- An interrupted build can leave an INVALID index that IF NOT EXISTS skips;
-- inspect pg_index.indisvalid and drop/rebuild that index before retrying.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_ticketNumber_trgm_idx" ON "Task" USING GIN ("ticketNumber" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Logs_LoggedById_createdAt_idx" ON "Logs"("LoggedById", "createdAt");
