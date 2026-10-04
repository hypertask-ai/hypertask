const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

test("recursive subtree SQL executes on disposable PostgreSQL with access/deletion pruning", { skip: process.env.HTPR_6509_S3_SQL !== "1" }, async () => {
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
  const script = `
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
      (9, 8, 15, 'Normal', NULL, 'deep', 9);
    ${queries.map((sql, index) => {
      assert.deepEqual(sql.values, [1, depths[index] ?? null, [15, 16]]);
      const replacements = ["1", String(depths[index] ?? "NULL"), "ARRAY[15,16]"];
      const query = sql.text.replace(/\$(\d+)/g, (_match, parameter) => replacements[Number(parameter) - 1]);
      return `SELECT '${index}:' || COALESCE(jsonb_agg(to_jsonb(q)), '[]'::jsonb)::text FROM (${query}) q;`;
    }).join("\n")}
  `;
  const output = execFileSync("docker", [
    "run", "--rm", "-i", "--user", "postgres", "postgres:16-alpine", "sh", "-c",
    "initdb -D /tmp/slice3-db -A trust >/dev/null 2>&1 && pg_ctl -D /tmp/slice3-db -l /tmp/slice3-pg.log -o '-k /tmp' -w start >/dev/null && psql -h /tmp -U postgres -v ON_ERROR_STOP=1 -tA; result=$?; pg_ctl -D /tmp/slice3-db -m fast -w stop >/dev/null; exit $result",
  ], { input: script, encoding: "utf8", timeout: 60000 });
  const results = output.split(/\r?\n/).filter((line) => /^\d:/.test(line)).map((line) => JSON.parse(line.slice(2)));
  assert.equal(results.length, depths.length);
  assert.deepEqual(results.map((rows) => rows.map(({ id }) => id)), [[2, 3, 8], [2, 3, 9, 8], [2, 3, 9, 8], [2, 3, 9, 8]]);
  for (const rows of results) {
    assert.equal(rows[1].title, "later", "archived accessible children stay visible");
    assert.equal(rows.at(-1).uniqueIndex, null, "PostgreSQL ascending null order is preserved");
    assert.ok(rows.every(({ id }) => ![4, 5, 6, 7].includes(id)), "denied/deleted parents prune accessible descendants");
  }
  console.log("Slice 3 PostgreSQL subtree fixture passed");
});
