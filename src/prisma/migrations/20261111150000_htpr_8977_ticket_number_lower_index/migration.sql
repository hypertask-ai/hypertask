CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_ticketNumber_lower_idx" ON "Task" (lower("ticketNumber"));
