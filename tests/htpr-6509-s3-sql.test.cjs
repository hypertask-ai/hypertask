const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

test("recursive subtree SQL executes on disposable PostgreSQL with live access/deletion pruning", { skip: process.env.HTPR_6509_S3_SQL !== "1" }, async () => {
  const tree = load("src/lib/aiChat/taskTree.ts", { "@/lib/prisma": {} });
  const queries = [];
  const depths = [2, 3, undefined, 2147483648];
  for (const depth of depths) {
    await tree.buildTaskTree(1, 7, depth, {
      task: { findFirst: async () => ({ id: 1, title: "root", ticketNumber: null, uniqueIndex: 0 }) },
      project: { findMany: async () => [{ id: 15 }, { id: 16 }] },
      $queryRaw: async (sql) => { queries.push(sql); return []; },
    });
  }
  function resultSql(sql, index) {
    const query = sql.text.replace(/\$(\d+)/g, (_match, parameter) => {
      const value = sql.values[Number(parameter) - 1];
      assert.ok(value === null || typeof value === "number" || Array.isArray(value));
      return value === null ? "NULL" : Array.isArray(value) ? `ARRAY[${value.join(",")}]` : String(value);
    });
    return `SELECT '${index}:' || COALESCE(jsonb_agg(to_jsonb(q)), '[]'::jsonb)::text FROM (${query}) q;`;
  }
  const script = `
    CREATE TABLE "Project" (id integer PRIMARY KEY, "teamId" text, "ownerId" integer);
    CREATE TABLE "Member" ("projectId" integer, "userId" integer, "agentId" text);
    INSERT INTO "Project" VALUES (15, 'team', 7), (16, 'team', 8), (99, 'team', 8), (100, NULL, 7);
    INSERT INTO "Member" VALUES (16, 7, NULL), (99, 7, 'agent-only');
    CREATE TABLE "Task" (id integer PRIMARY KEY, "parentTaskId" integer, "projectId" integer, status text, "ticketNumber" text, title text, "uniqueIndex" integer);
    INSERT INTO "Task" VALUES
      (1, NULL, 15, 'Deleted', NULL, 'root', 0),
      (2, 1, 15, 'Normal', 'T-2', 'first', 2),
      (3, 1, 16, 'Archive', 'T-3', 'later', 3),
      (4, 1, 99, 'Normal', NULL, 'hidden', 1),
      (5, 4, 15, 'Normal', NULL, 'behind hidden', 5),
      (6, 2, 15, 'Deleted', NULL, 'deleted', 6),
      (7, 6, 15, 'Normal', NULL, 'behind deleted', 7),
      (8, 2, 16, 'Normal', 'T-8', 'leaf', NULL),
      (9, 8, 15, 'Normal', NULL, 'deep', 9),
      (10, 1, 100, 'Normal', NULL, 'teamless', 10);
    ${queries.map(resultSql).join("\n")}
    DELETE FROM "Member" WHERE "projectId" = 16;
    ${resultSql(queries[2], 4)}
    INSERT INTO "Member" VALUES (16, 7, NULL);
    UPDATE "Project" SET "ownerId" = 8 WHERE id = 15;
    ${resultSql(queries[2], 5)}
  `;
  const output = execFileSync("docker", [
    "run", "--rm", "-i", "--user", "postgres", "postgres:16-alpine", "sh", "-c",
    "initdb -D /tmp/slice3-db -A trust >/dev/null 2>&1 && pg_ctl -D /tmp/slice3-db -l /tmp/slice3-pg.log -o '-k /tmp' -w start >/dev/null && psql -h /tmp -U postgres -v ON_ERROR_STOP=1 -tA; result=$?; pg_ctl -D /tmp/slice3-db -m fast -w stop >/dev/null; exit $result",
  ], { input: script, encoding: "utf8", timeout: 60000 });
  const results = output.split(/\r?\n/).filter((line) => /^\d:/.test(line)).map((line) => JSON.parse(line.slice(2)));
  assert.equal(results.length, depths.length + 2);
  assert.deepEqual(results.slice(0, depths.length).map((rows) => rows.map(({ id }) => id)), [[2, 3, 8], [2, 3, 9, 8], [2, 3, 9, 8], [2, 3, 9, 8]]);
  for (const rows of results.slice(0, depths.length)) {
    assert.equal(rows[1].title, "later", "archived accessible children stay visible");
    assert.equal(rows.at(-1).uniqueIndex, null, "PostgreSQL ascending null order is preserved");
    assert.ok(rows.every(({ id }) => ![4, 5, 6, 7, 10].includes(id)), "denied/deleted parents prune accessible descendants");
  }
  assert.deepEqual(results[4].map(({ id }) => id), [2], "membership removed after preloading must hide children and prune descendants");
  assert.deepEqual(results[5].map(({ id }) => id), [3], "ownership removed after preloading must hide children and prune descendants");
  console.log("Slice 3 PostgreSQL subtree fixture passed");
});
