-- Every stored message already implies its author: a human message is the
-- session owner's, and a delivered assistant message in an agent session is
-- that agent's.
--
-- Its own migration so the row lock here is a plain ROW EXCLUSIVE that readers
-- pass through, instead of sharing the ACCESS EXCLUSIVE lock of the ADD COLUMN.
-- One statement, not two: the human and assistant row sets are disjoint, so a
-- second pass would rewrite the whole table again for nothing. CASE without an
-- ELSE yields NULL, and both columns are NULL before this runs, so neither
-- branch can set the column belonging to the other role.
--
-- ponytail: one unbatched pass, like every other backfill in this folder. The
-- ceiling is table size: if ChatMessage ever grows past what one transaction
-- should rewrite, move this to a post-deploy script that commits by id range.
UPDATE "ChatMessage" AS message
SET
  "authorUserId" = CASE WHEN message."role" = 'human' THEN session."userId" END,
  "authorAgentId" = CASE WHEN message."role" = 'assistant' THEN session."agentId" END
FROM "ChatSession" AS session
WHERE message."sessionId" = session."id"
  AND (
    -- The scheduler writes the heartbeat prompt in the human role, and it
    -- flips to delivered the moment its turn starts
    -- (src/app/api/ai/chat/stream/route.ts), so delivery cannot tell a
    -- person's words from the scheduler's. The envelope marker can
    -- (src/lib/nativeAgent/heartbeatTurnEnvelope.ts).
    (
      message."role" = 'human'
      AND message."content" NOT LIKE '%<!--ht-heartbeat:v1:%'
    )
    -- Delivery is the right test on this side: an undelivered assistant row is
    -- a system notice about the turn, not the agent's answer.
    OR (
      message."role" = 'assistant'
      AND message."isDelivered" = true
      AND session."agentId" IS NOT NULL
    )
  );
