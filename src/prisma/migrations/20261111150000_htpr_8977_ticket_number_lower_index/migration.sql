-- HTPR-8977: ticket-number lookups compare case-insensitively, and a parameterised
-- ILIKE on that column cannot use the plain ticket number index, so every lookup
-- scanned the whole Task table. The same comparison on lower("ticketNumber") can
-- use this expression index instead.
--
-- Like 20261110120000_htpr_8977_db_load_indexes, run outside an explicit
-- transaction: Prisma's PostgreSQL migrate deploy does not wrap this file. An
-- interrupted build can leave an INVALID index that IF NOT EXISTS skips; inspect
-- pg_index.indisvalid and drop/rebuild that index before retrying.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_ticketNumber_lower_idx" ON "Task" (lower("ticketNumber"));
