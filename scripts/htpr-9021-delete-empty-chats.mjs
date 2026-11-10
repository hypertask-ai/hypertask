import pg from "pg";
import { fileURLToPath } from "node:url";

export const EMPTY_CHAT_FILTER = `s."agentId" IS NULL
  AND s."createdAt" < now() - interval '1 hour'
  AND NOT EXISTS (SELECT 1 FROM "ChatMessage" m WHERE m."sessionId" = s.id)
  AND NOT EXISTS (SELECT 1 FROM "AgentRun" r WHERE r."chatSessionId" = s.id)
  AND NOT EXISTS (SELECT 1 FROM "ChatSessionParticipant" p WHERE p."sessionId" = s.id)`;

export const COUNT_SQL = `SELECT count(*)::int AS count FROM "ChatSession" s WHERE ${EMPTY_CHAT_FILTER}`;

export const DELETE_BATCH_SQL = `DELETE FROM "ChatSession" WHERE id IN (
  SELECT s.id FROM "ChatSession" s WHERE ${EMPTY_CHAT_FILTER} ORDER BY s."createdAt" LIMIT $1
)`;

export const BATCH_SIZE = 500;

export async function run(db, apply, log = console.log) {
  const { rows } = await db.query(COUNT_SQL);
  const total = rows[0].count;
  log(`${total} empty chat sessions match`);
  if (!apply) {
    log("dry run, nothing deleted; pass --apply to delete");
    return { total, deleted: 0 };
  }
  let deleted = 0;
  for (;;) {
    const result = await db.query(DELETE_BATCH_SQL, [BATCH_SIZE]);
    if (!result.rowCount) break;
    deleted += result.rowCount;
    log(`deleted ${deleted} of ${total}`);
  }
  const remaining = (await db.query(COUNT_SQL)).rows[0].count;
  log(`${remaining} empty chat sessions remain`);
  return { total, deleted, remaining };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await run(db, process.argv.includes("--apply"));
  } finally {
    await db.end();
  }
}
