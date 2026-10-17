-- YPER4-422, YPER4-423, YPER4-424: the hourly guest cleanup deletes by these
-- columns, and each delete scanned the whole table. Assignees deletes also
-- check Notification.assignId for ON DELETE SET NULL.
--
-- Like 20261012011000_mcp_my_tasks_order_index, run outside an explicit
-- transaction: Prisma's PostgreSQL migrate deploy does not wrap this file.
-- An interrupted build can leave an INVALID index that IF NOT EXISTS skips;
-- inspect pg_index.indisvalid and drop/rebuild that index before retrying.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Notification_assignId_idx" ON "Notification"("assignId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Description_creatorId_idx" ON "Description"("creatorId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Comment_creatorId_idx" ON "Comment"("creatorId");
