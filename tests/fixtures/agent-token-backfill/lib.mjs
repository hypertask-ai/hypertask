import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";

export const CONTAINER = "ht4671pg";

// Throwaway container, so the password is generated per run rather than
// written down. Override to reuse a container across runs.
const POSTGRES_PASSWORD =
  process.env.HTPR4671_PG_PASSWORD ?? crypto.randomUUID();

export function ensurePostgres() {
  const running = execFileSync("docker", ["ps", "--filter", `name=^${CONTAINER}$`, "--format", "{{.Names}}"])
    .toString().trim();
  if (running !== CONTAINER) {
    try { execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" }); } catch {}
    execFileSync("docker", ["run", "-d", "--name", CONTAINER, "-e", `POSTGRES_PASSWORD=${POSTGRES_PASSWORD}`, "postgres:16"], { stdio: "ignore" });
  }
  for (let i = 0; i < 60; i++) {
    try { execFileSync("docker", ["exec", CONTAINER, "pg_isready", "-U", "postgres"], { stdio: "ignore" }); return; } catch {}
    execFileSync("sleep", ["1"]);
  }
  throw new Error("postgres did not become ready");
}

export function psql(sql, { db = "postgres", tuplesOnly = true } = {}) {
  const args = ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-q", "-A", "-F", "\t"];
  if (tuplesOnly) args.push("-t");
  return execFileSync("docker", [...args, "-c", sql]).toString();
}

export function psqlFile(sqlText, { db = "postgres" } = {}) {
  const path = `${os.tmpdir()}/htpr4671-apply-${crypto.randomUUID()}.sql`;
  fs.writeFileSync(path, sqlText);
  execFileSync("docker", ["cp", path, `${CONTAINER}:/tmp/apply.sql`]);
  return execFileSync("docker", ["exec", CONTAINER, "psql", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-q", "-f", "/tmp/apply.sql"]).toString();
}

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

/** JWTs shaped like the real agent credential, covering every base64url padding class. */
export function sampleTokens(count = 200) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const payload = {
      userId: i,
      sub: "a".repeat(i % 17) + "@example.test",
      agentId: crypto.randomUUID(),
      jti: crypto.randomUUID(),
      iss: "https://app.hypertask.ai",
      aud: "mcp-api",
      iat: 1700000000 + i,
    };
    const token =
      b64u({ alg: "HS256", typ: "JWT" }) + "." + b64u(payload) + "." +
      crypto.randomBytes(32).toString("base64url");
    rows.push({
      i,
      token,
      jti: payload.jti,
      hash: crypto.createHash("sha256").update(token).digest("hex"),
      pad: token.split(".")[1].length % 4,
    });
  }
  return rows;
}

export function loadTokens(rows, table, db = "postgres") {
  const path = `${os.tmpdir()}/htpr4671-rows.tsv`;
  fs.writeFileSync(path, rows.map((r) => `${r.i}\t${r.token}`).join("\n") + "\n");
  execFileSync("docker", ["cp", path, `${CONTAINER}:/tmp/rows.tsv`]);
  execFileSync("docker", ["exec", CONTAINER, "psql", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-q",
    "-c", `\\copy ${table}(i, "mcpToken") FROM '/tmp/rows.tsv' WITH (FORMAT text)`]);
}
