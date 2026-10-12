import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const literal = (value) => `'${value.replaceAll("'", "''")}'`;

export function redact(text, urls) {
  for (const value of urls.filter(Boolean)) {
    text = text.replaceAll(value, "[DATABASE_URL]");
    try {
      const password = new URL(value).password;
      if (password) {
        text = text.replaceAll(password, "[PASSWORD]");
        text = text.replaceAll(decodeURIComponent(password), "[PASSWORD]");
      }
    } catch {
      // Invalid configuration must still be reportable without exposing it.
    }
  }
  return text.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[DATABASE_URL]");
}

// information_schema (used by Prisma) hides columns from a catalog-only role.
// Reconstruct only schema in a disposable local DB; never grant board SELECT.
export async function catalogSchema(client, { includeLegacy = false, log = console.log } = {}) {
  const { rows: relations } = await client.query(`
    SELECT c.oid, c.relname, c.relkind, c.relispartition
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','f','v','m') ORDER BY c.relname`);
  if (relations.some((r) => r.relkind !== "r" || r.relispartition)) {
    throw new Error("Unsupported public relation kind: refusing an incomplete schema audit.");
  }
  const { rows: enums } = await client.query(`
    SELECT t.typname, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
    FROM pg_catalog.pg_type t JOIN pg_catalog.pg_enum e ON e.enumtypid=t.oid
    JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
    WHERE n.nspname='public' GROUP BY t.typname ORDER BY t.typname`);
  const { rows: sequences } = await client.query(`
    SELECT c.relname, format_type(s.seqtypid,NULL) AS type, s.seqstart, s.seqincrement,
      s.seqmin, s.seqmax, s.seqcache, s.seqcycle
    FROM pg_catalog.pg_sequence s JOIN pg_catalog.pg_class c ON c.oid=s.seqrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' ORDER BY c.relname`);
  const { rows: columns } = await client.query(`
    SELECT c.relname, a.attname, format_type(a.atttypid,a.atttypmod) AS type,
      a.attnotnull, a.attidentity, a.attgenerated, pg_get_expr(d.adbin,d.adrelid) AS default_expr
    FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY c.relname,a.attnum`);
  if (columns.some((c) => c.attidentity || c.attgenerated)) {
    throw new Error("Unsupported identity/generated column: refusing an incomplete schema audit.");
  }
  const { rows: constraints } = await client.query(`
    SELECT c.relname, con.conname, con.contype, pg_get_constraintdef(con.oid) AS definition
    FROM pg_catalog.pg_constraint con JOIN pg_catalog.pg_class c ON c.oid=con.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND con.contype <> 'n'
    ORDER BY (con.contype='f'),c.relname,con.conname`);
  const { rows: indexes } = await client.query(`
    SELECT c.relname, pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND NOT EXISTS
      (SELECT FROM pg_catalog.pg_constraint con WHERE con.conindid=i.indexrelid AND con.contype IN ('p','u','x'))
    ORDER BY i.indexrelid`);
  // Unused additive legacy objects, absent from both schema.prisma and migration
  // history; retain their data, but do not mistake them for missing app schema.
  // Full unfiltered audit: SCHEMA_DRIFT_INCLUDE_LEGACY=1 (see the ticket report).
  const ignoredTable = (name) => !includeLegacy && name === "AI_Knowledge_Source";
  const ignoredColumn = (c) => !includeLegacy && (
    (c.relname === "AiUsage" && c.attname === "cacheReadInputTokens") ||
    (c.relname === "UserSetting" && c.attname === "savedCrossBoardViews")
  );
  for (const r of relations.filter((r) => ignoredTable(r.relname))) log(`Retaining unmanaged legacy table: ${r.relname}`);
  for (const c of columns.filter(ignoredColumn)) log(`Retaining unmanaged legacy column: ${c.relname}.${c.attname}`);
  const ddl = ["SET search_path = public, pg_catalog;"];
  for (const e of enums) ddl.push(`CREATE TYPE ${quote(e.typname)} AS ENUM (${e.labels.map(literal).join(", ")});`);
  for (const s of sequences) ddl.push(`CREATE SEQUENCE ${quote(s.relname)} AS ${s.type} START ${s.seqstart} INCREMENT ${s.seqincrement} MINVALUE ${s.seqmin} MAXVALUE ${s.seqmax} CACHE ${s.seqcache} ${s.seqcycle ? "CYCLE" : "NO CYCLE"};`);
  for (const r of relations.filter((r) => !ignoredTable(r.relname))) {
    const cols = columns.filter((c) => c.relname === r.relname && !ignoredColumn(c)).map((c) =>
      `${quote(c.attname)} ${c.type}${c.default_expr ? ` DEFAULT ${c.default_expr}` : ""}${c.attnotnull ? " NOT NULL" : ""}`);
    ddl.push(`CREATE TABLE ${quote(r.relname)} (${cols.join(", ")});`);
  }
  for (const c of constraints.filter((c) => c.contype !== "f" && !ignoredTable(c.relname))) ddl.push(`ALTER TABLE ${quote(c.relname)} ADD CONSTRAINT ${quote(c.conname)} ${c.definition};`);
  for (const i of indexes.filter((i) => !ignoredTable(i.relname))) ddl.push(`${i.definition};`);
  for (const c of constraints.filter((c) => c.contype === "f" && !ignoredTable(c.relname))) ddl.push(`ALTER TABLE ${quote(c.relname)} ADD CONSTRAINT ${quote(c.conname)} ${c.definition};`);
  return ddl.join("\n");
}

export async function checkDrift({ env = process.env, spawn = spawnSync, log = console.log, Client = pg.Client } = {}) {
  const readerUrl = env.SCHEMA_READER_DATABASE_URL;
  const shadowUrl = env.SCHEMA_SHADOW_DATABASE_URL;
  if (!readerUrl || !shadowUrl) throw new Error("SCHEMA_READER_DATABASE_URL and SCHEMA_SHADOW_DATABASE_URL are required.");
  const shadow = new URL(shadowUrl);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(shadow.hostname)) {
    throw new Error("Shadow database must be disposable local PostgreSQL.");
  }
  const snapshotName = `schema_drift_${randomUUID().replaceAll("-", "")}`;
  const snapshotUrl = new URL(shadowUrl);
  snapshotUrl.pathname = `/${snapshotName}`;
  const reader = new Client({ connectionString: readerUrl, statement_timeout: 30_000, connectionTimeoutMillis: 15_000 });
  const local = new Client({ connectionString: shadowUrl });
  const snapshot = new Client({ connectionString: snapshotUrl.href });
  const temp = mkdtempSync(path.join(tmpdir(), "schema-drift-"));
  let created = false;
  try {
    await reader.connect();
    await reader.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const ddl = await catalogSchema(reader, { includeLegacy: env.SCHEMA_DRIFT_INCLUDE_LEGACY === "1", log });
    await reader.query("COMMIT");
    await local.connect();
    await local.query(`CREATE DATABASE ${quote(snapshotName)}`);
    created = true;
    await snapshot.connect();
    await snapshot.query(ddl);
    await snapshot.end();
    const config = path.join(temp, "prisma.config.mjs");
    writeFileSync(config, `import { defineConfig } from ${JSON.stringify(pathToFileURL(path.join(root, "node_modules/prisma/config.js")).href)};\nexport default defineConfig({ schema: ${JSON.stringify(path.join(root, "src/prisma/schema.prisma"))}, datasource: { url: process.env.SCHEMA_SNAPSHOT_DATABASE_URL, shadowDatabaseUrl: process.env.SCHEMA_SHADOW_DATABASE_URL } });\n`);
    const from = env.SCHEMA_DRIFT_SOURCE === "datamodel"
      ? ["--from-schema", path.join(root, "src/prisma/schema.prisma")]
      : ["--from-migrations", path.join(root, "src/prisma/migrations")];
    const args = [path.join(root, "node_modules/prisma/build/index.js"), "migrate", "diff", "--config", config, ...from, "--to-config-datasource", "--exit-code"];
    if (env.SCHEMA_DRIFT_FORMAT === "script") args.push("--script");
    const result = spawn(process.execPath, args, { cwd: root, env: { ...env, SCHEMA_SNAPSHOT_DATABASE_URL: snapshotUrl.href }, encoding: "utf8", timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
    const output = redact(`${result.stdout || ""}${result.stderr || ""}`, [readerUrl, shadowUrl, snapshotUrl.href]);
    if (output.trim()) log(output.trim());
    let table;
    for (const line of output.split("\n")) {
      const changedTable = line.match(/Changed the `([^`]+)` table/);
      if (changedTable) table = changedTable[1];
      const column = line.match(/(?:Added|Removed|Altered) column `([^`]+)`/);
      if (table && column) log(`Schema drift: ${table}.${column[1]} — ${line.trim()}`);
    }
    if (result.error || ![0, 2].includes(result.status)) throw new Error("Schema drift comparison failed (not a clean schema).");
    log(result.status === 0 ? "Schema drift check: clean." : "Schema drift check: DRIFT detected (expected -> actual). Not repair SQL.");
    return result.status;
  } finally {
    await reader.end();
    await snapshot.end();
    if (created) await local.query(`DROP DATABASE ${quote(snapshotName)} WITH (FORCE)`);
    await local.end();
    rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await checkDrift();
  } catch (error) {
    console.error(redact(`Schema drift check failed: ${error.message}`, [process.env.SCHEMA_READER_DATABASE_URL, process.env.SCHEMA_SHADOW_DATABASE_URL]));
    process.exitCode = 1;
  }
}
