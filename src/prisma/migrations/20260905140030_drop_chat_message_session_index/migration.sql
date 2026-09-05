-- Strict prefix of ChatMessage_sessionId_createdAt_id_idx, built by the
-- migration before this one, so it serves no read the composite does not and
-- costs a second B-tree write on every insert. Dropped only after the
-- replacement exists, and concurrently so it never takes ACCESS EXCLUSIVE.
DROP INDEX CONCURRENTLY IF EXISTS "ChatMessage_sessionId_idx";
