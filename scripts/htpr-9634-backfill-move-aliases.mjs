import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
export const BLANK_ALIAS_SQL = `SELECT a.id, a."projectId", a."uniqueIndex", p."uniqueIdentifier" FROM "TaskNumberAlias" a JOIN "Project" p ON p.id = a."projectId" WHERE (a."ticketNumber" IS NULL OR btrim(a."ticketNumber") = '') AND p."uniqueIdentifier" IS NOT NULL AND btrim(p."uniqueIdentifier") <> ''`;
export const FILL_BLANK_ALIAS_SQL = `UPDATE "TaskNumberAlias" a SET "ticketNumber" = p."uniqueIdentifier" || '-' || a."uniqueIndex" FROM "Project" p WHERE p.id = a."projectId" AND (a."ticketNumber" IS NULL OR btrim(a."ticketNumber") = '') AND p."uniqueIdentifier" IS NOT NULL AND btrim(p."uniqueIdentifier") <> ''`;
export const MOVE_ACTIVITY_GAPS_SQL = `SELECT DISTINCT c."taskId", s."projectId" AS "fromProjectId", p."uniqueIdentifier" AS "fromPrefix", t."ticketNumber" AS "currentTicketNumber" FROM "Comment" c JOIN "Task" t ON t.id = c."taskId" JOIN "Section" s ON s.id = (c.activity #>> '{data,fromSection,sectionId}')::int JOIN "Project" p ON p.id = s."projectId" WHERE c.activity->>'type' = 'TaskMove' AND s."projectId" <> t."projectId" AND NOT EXISTS (SELECT 1 FROM "TaskNumberAlias" a WHERE a."taskId" = c."taskId" AND a."projectId" = s."projectId")`;
export const INSERT_ALIAS_SQL = `INSERT INTO "TaskNumberAlias" ("projectId", "uniqueIndex", "ticketNumber", "taskId") VALUES ($1, $2, $3, $4) ON CONFLICT ("projectId", "uniqueIndex") DO NOTHING`;
export function gapsWithoutMapping(moveGaps, mapping) {
  return moveGaps.filter((gap) => !mapping.some((m) => m.projectId === gap.fromProjectId && m.taskId === gap.taskId));
}
export function describeGap(gap) {
  return `task ${gap.taskId} left board ${gap.fromProjectId} (${gap.fromPrefix}) and is now ${gap.currentTicketNumber ?? "untitled"}; its old unique index was never persisted, so add { projectId: ${gap.fromProjectId}, taskId: ${gap.taskId}, uniqueIndex: <old index>, ticketNumber: "${gap.fromPrefix}-<old index>" } to --mapping`;
}
export function resolveMappedKey(entry, moveGaps) {
  const gap = moveGaps.find((g) => g.fromProjectId === entry.projectId && g.taskId === entry.taskId);
  if (!entry.ticketNumber && gap?.fromPrefix && Number.isSafeInteger(entry.uniqueIndex) && entry.uniqueIndex > 0) return `${gap.fromPrefix.toUpperCase()}-${entry.uniqueIndex}`;
  return entry.ticketNumber ?? null;
}
export function mappedInserts(mapping, moveGaps) {
  return mapping.map((entry) => ({ ...entry, ticketNumber: resolveMappedKey(entry, moveGaps) }));
}
export async function run(db, { apply = false, mapping = [] } = {}, log = console.log) {
  const blanks = (await db.query(BLANK_ALIAS_SQL)).rows, moveGaps = (await db.query(MOVE_ACTIVITY_GAPS_SQL)).rows;
  const unmapped = gapsWithoutMapping(moveGaps, mapping), inserts = mappedInserts(mapping, moveGaps);
  const keyless = inserts.filter((entry) => !entry.ticketNumber);
  log(`${blanks.length} blank aliases; ${moveGaps.length} move gaps; ${unmapped.length} gaps have no recorded key and need --mapping; ${inserts.length} mapped inserts ready`);
  for (const gap of unmapped) log(`needs mapping: ${describeGap(gap)}`);
  if (keyless.length) throw new Error(`--mapping entries need a ticketNumber (or a uniqueIndex and a move gap on that board): ${keyless.map((entry) => `task ${entry.taskId} on board ${entry.projectId}`).join(", ")}`);
  if (!apply) { log("dry run; pass --apply to write"); return { blanks: blanks.length, moveGaps: moveGaps.length, needsMapping: unmapped.length, candidates: inserts.length, updated: 0, inserted: 0 }; }
  await db.query("BEGIN");
  try {
    const updated = blanks.length ? (await db.query(FILL_BLANK_ALIAS_SQL)).rowCount ?? 0 : 0;
    let inserted = 0;
    for (const r of inserts) inserted += (await db.query(INSERT_ALIAS_SQL, [r.projectId, r.uniqueIndex, r.ticketNumber, r.taskId])).rowCount ?? 0;
    await db.query("COMMIT");
    return { blanks: blanks.length, moveGaps: moveGaps.length, needsMapping: unmapped.length, candidates: inserts.length, updated, inserted };
  } catch (error) { await db.query("ROLLBACK"); throw error; }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required"); process.exit(1); }
  const { default: pg } = await import("pg"), i = process.argv.indexOf("--mapping"), db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const mapping = i >= 0 && process.argv[i + 1] ? JSON.parse(readFileSync(process.argv[i + 1], "utf8")) : [];
  await db.connect();
  try {
    const result = await run(db, { apply: process.argv.includes("--apply"), mapping });
    if (result.needsMapping > 0) { console.error(`${result.needsMapping} move gaps still have no alias; supply --mapping to repair them`); process.exitCode = 1; }
  } finally { await db.end(); }
}
