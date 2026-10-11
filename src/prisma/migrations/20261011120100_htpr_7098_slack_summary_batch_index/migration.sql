-- HTPR-7098: built on its own and CONCURRENTLY (same as 20260928180000_search_operator_task_indexes),
-- so it never holds a lock that blocks Slack thread writes.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SlackWatchedThread_summaryBatchId_idx" ON "SlackWatchedThread"("summaryBatchId");
