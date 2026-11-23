import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
export const BLANK_ALIAS_SQL = `SELECT a.id, a."projectId", a."uniqueIndex", p."uniqueIdentifier" FROM "TaskNumberAlias" a JOIN "Project" p ON p.id = a."projectId" WHERE (a."ticketNumber" IS NULL OR btrim(a."ticketNumber") = '') AND p."uniqueIdentifier" IS NOT NULL AND btrim(p."uniqueIdentifier") <> ''`;
export const FILL_BLANK_ALIAS_SQL = `UPDATE "TaskNumberAlias" a SET "ticketNumber" = p."uniqueIdentifier" || '-' || a."uniqueIndex" FROM "Project" p WHERE p.id = a."projectId" AND (a."ticketNumber" IS NULL OR btrim(a."ticketNumber") = '') AND p."uniqueIdentifier" IS NOT NULL AND btrim(p."uniqueIdentifier") <> ''`;
export const MOVE_ACTIVITY_GAPS_SQL = `SELECT DISTINCT c."taskId", s."projectId" AS "fromProjectId", p."uniqueIdentifier" AS "fromPrefix", t."ticketNumber" AS "currentTicketNumber", c.text AS "commentText" FROM "Comment" c JOIN "Task" t ON t.id = c."taskId" JOIN "Section" s ON s.id = (c.activity #>> '{data,fromSection,sectionId}')::int JOIN "Project" p ON p.id = s."projectId" WHERE c.activity->>'type' = 'TaskMove' AND s."projectId" <> t."projectId" AND NOT EXISTS (SELECT 1 FROM "TaskNumberAlias" a WHERE a."taskId" = c."taskId" AND a."projectId" = s."projectId")`;
export const INSERT_ALIAS_SQL = `INSERT INTO "TaskNumberAlias" ("projectId", "uniqueIndex", "ticketNumber", "taskId") VALUES ($1, $2, $3, $4) ON CONFLICT ("projectId", "uniqueIndex") DO NOTHING`;
export function extractLegacyKey(row) {
  const m = row.fromPrefix && new RegExp(`\\b(${row.fromPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})-(\\d+)\\b`, "i").exec(String(row.commentText ?? ""));
  const uniqueIndex = m ? Number(m[2]) : 0;
  return Number.isSafeInteger(uniqueIndex) && uniqueIndex > 0 ? { projectId: row.fromProjectId, uniqueIndex, ticketNumber: `${row.fromPrefix.toUpperCase()}-${uniqueIndex}`, taskId: row.taskId } : null;
}
export async function run(db, { apply = false, mapping = [] } = {}, log = console.log) {
  const blanks = (await db.query(BLANK_ALIAS_SQL)).rows, moveGaps = (await db.query(MOVE_ACTIVITY_GAPS_SQL)).rows;
  const candidates = [...moveGaps.map(extractLegacyKey).filter(Boolean), ...mapping];
  log(`${blanks.length} blank aliases; ${moveGaps.length} move gaps; ${candidates.length} inserts ready`);
  if (!apply) { log("dry run; pass --apply to write"); return { blanks: blanks.length, moveGaps: moveGaps.length, candidates: candidates.length, updated: 0, inserted: 0 }; }
  await db.query("BEGIN");
  try {
    const updated = blanks.length ? (await db.query(FILL_BLANK_ALIAS_SQL)).rowCount ?? 0 : 0;
    let inserted = 0;
    for (const r of candidates) inserted += (await db.query(INSERT_ALIAS_SQL, [r.projectId, r.uniqueIndex, r.ticketNumber, r.taskId])).rowCount ?? 0;
    await db.query("COMMIT");
    return { blanks: blanks.length, moveGaps: moveGaps.length, candidates: candidates.length, updated, inserted };
  } catch (error) { await db.query("ROLLBACK"); throw error; }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required"); process.exit(1); }
  const { default: pg } = await import("pg"), i = process.argv.indexOf("--mapping"), db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const mapping = i >= 0 && process.argv[i + 1] ? JSON.parse(readFileSync(process.argv[i + 1], "utf8")) : [];
  await db.connect();
  try { await run(db, { apply: process.argv.includes("--apply"), mapping }); } finally { await db.end(); }
}
