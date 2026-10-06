const assert = require("node:assert/strict");
const test = require("node:test");
const { PrismaClient } = require("@prisma/client");
const { ColumnTypeEnum } = require("@prisma/driver-adapter-utils");
const { load } = require("./task-route-loader.cjs");
const { graph, getProjectWhere, models, projectRow, visibility } = require("./legacy-task-relations-fixture.cjs");
const contract = require("./legacy-task-relations-contract.json");

async function planned(mode) {
  let args;
  const queries = [];
  const adapter = {
    provider: "postgres", adapterName: "read-only-task-relations-fixture",
    connect: async () => ({
      provider: "postgres", adapterName: "read-only-task-relations-fixture",
      dispose: async () => {},
      executeRaw: async () => { throw new Error("Synthetic fixture forbids writes"); },
      queryRaw: async ({ sql }) => {
        queries.push(sql);
        assert.match(sql, /LEFT JOIN LATERAL/);
        const roots = graph().map((item) => projectRow("Task", item, args));
        const names = Object.keys(roots[0]);
        const types = names.map((name) => {
          const field = models.get("Task").fields.find((candidate) => candidate.name === name);
          if (field.kind === "object" || field.type === "Json") return ColumnTypeEnum.Json;
          if (field.type === "Int") return ColumnTypeEnum.Int32;
          if (field.type === "DateTime") return ColumnTypeEnum.DateTime;
          return ColumnTypeEnum.Text;
        });
        return { columnNames: names, columnTypes: types, rows: roots.map((item) => names.map((name) => item[name])) };
      },
    }),
  };
  const client = new PrismaClient({ adapter });
  const controller = load("src/utils/controllers/tasks/getAll.ts", {
    "@/lib/prisma": { default: { task: { findMany: (input) => { args = input; return client.task.findMany(input); } } } },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere },
    "@/lib/agents/visibility": visibility,
  }).default;
  try {
    const response = await controller(15, 7, mode);
    assert.equal(response.status, 200);
    assert.equal(response.json.length, 2, "Planner failures must not pass as empty-list fallback");
    return { args, queries, text: JSON.stringify(response.json) };
  } finally {
    await client.$disconnect();
  }
}

test("generated Prisma planner uses narrower joined projections, not post-processing full relations", async () => {
  const legacy = await planned("legacy");
  const compact = await planned("compact");
  assert.deepEqual(legacy.args, contract.args);
  assert.equal(legacy.text, contract.text);
  assert.equal(legacy.queries.length, 1);
  assert.equal(compact.queries.length, 1);
  assert.match(legacy.queries[0], /'description'/);
  assert.doesNotMatch(compact.queries[0], /'description'/);
  for (const result of [legacy, compact]) {
    assert.match(result.queries[0], /"ownerId" =/);
    assert.match(result.queries[0], /"userId" =/);
    assert.match(result.queries[0], /"status" <>/);
    assert.equal(result.args.relationLoadStrategy, "join");
    assert.deepEqual(result.args.orderBy, { ranking: "asc" });
    assert.deepEqual(result.args.select.subTasks.where, legacy.args.select.subTasks.where);
    assert.deepEqual(result.args.select.subTasks.orderBy, legacy.args.select.subTasks.orderBy);
  }
  assert.deepEqual(compact.args.select.parentTask.select.subTasks.where, legacy.args.select.parentTask.include.subTasks.where);
  assert.equal(compact.args.select.parentTask.select.subTasks.orderBy, undefined, "Parent's children retain their original database order");
  const oldBytes = Buffer.byteLength(legacy.text);
  const newBytes = Buffer.byteLength(compact.text);
  assert.ok(newBytes < oldBytes, `${oldBytes} -> ${newBytes}`);
  console.log(`Synthetic full-row payload bytes: ${oldBytes} -> ${newBytes}; SQL calls: 1 -> 1 (not a production speed claim)`);
});
