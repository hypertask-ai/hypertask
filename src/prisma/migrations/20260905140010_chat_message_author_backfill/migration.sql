-- Every stored message already implies its author: a delivered human message
-- is the session owner's, a delivered assistant message in an agent session is
-- that agent's. Undelivered rows are machine-generated markers and stay
-- unattributed, which is what the runtime does for new rows too.
--
-- Its own migration so the row lock here is a plain ROW EXCLUSIVE that readers
-- pass through, instead of sharing the ACCESS EXCLUSIVE lock of the ADD COLUMN.
--
-- ponytail: one unbatched pass, like every other backfill in this folder. The
-- ceiling is table size: if ChatMessage ever grows past what one transaction
-- should rewrite, move this to a post-deploy script that commits by id range.
UPDATE "ChatMessage" AS message
SET "authorUserId" = session."userId"
FROM "ChatSession" AS session
WHERE message."sessionId" = session."id"
  AND message."role" = 'human'
  AND message."isDelivered" = true
  -- A heartbeat prompt flips to delivered the moment its turn starts
  -- (src/app/api/ai/chat/stream/route.ts), so delivered alone would sign the
  -- scheduler's words with the owner's name. The envelope marker is stable
  -- (src/lib/nativeAgent/heartbeatTurnEnvelope.ts).
  AND message."content" NOT LIKE '%<!--ht-heartbeat:v1:%';

UPDATE "ChatMessage" AS message
SET "authorAgentId" = session."agentId"
FROM "ChatSession" AS session
WHERE message."sessionId" = session."id"
  AND message."role" = 'assistant'
  AND message."isDelivered" = true
  AND session."agentId" IS NOT NULL;
