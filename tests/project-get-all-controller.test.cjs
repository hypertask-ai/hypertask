const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function loadController(prisma, calls) {
  const source = fs.readFileSync(
    path.join(root, "src/utils/controllers/projects/getAll.ts"),
    "utf8",
  );
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  const stubs = {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "./getAllIncludes": {
      getProjectIncludeWithoutTasks: (options) => {
        calls.push(["full-project-include", options]);
        return { members: true };
      },
      getProjectWhere: (userId) => ({ OR: [{ ownerId: userId }] }),
      projectBootstrapSelect: { id: true, title: true },
    },
    "@/utils/helperFunctions/Views/BoardFilterSanitizer": {
      sanitizeProjectBoardFilters: (project) => ({
        ...project,
        sanitized: true,
      }),
    },
  };
  const mod = { exports: {} };
  new Function("module", "exports", "require", javascript)(
    mod,
    mod.exports,
    (request) => stubs[request] ?? require(request),
  );
  return mod.exports.default;
}

test("active project bootstrap avoids duplicate full metadata reads", async () => {
  const calls = [];
  const prisma = {
    user: {
      findUnique: async (args) => {
        calls.push(["user", args]);
        return { id: 6 };
      },
    },
    project: {
      findMany: async (args) => {
        calls.push(["projects", args]);
        return [
          { id: 15, title: "Hypertask Product" },
          { id: 16, title: "Second board" },
        ];
      },
      findFirst: async (args) => {
        calls.push(["active-project", args]);
        return { id: 15, title: "Hypertask Product", members: [] };
      },
    },
  };
  const getAllProjects = loadController(prisma, calls);

  const result = await getAllProjects(6, 6, 15);

  assert.deepEqual(
    calls.filter(([name]) => name === "user" || name === "projects").map(([name]) => name),
    ["user", "projects"],
  );
  assert.equal(calls.some(([name]) => name === "active-project"), false);
  assert.equal(calls.some(([name]) => name === "full-project-include"), false);
  assert.deepEqual(calls.find(([name]) => name === "projects")[1], {
    where: { status: "Normal", OR: [{ ownerId: 6 }] },
    select: { id: true, title: true },
    orderBy: { id: "asc" },
  });
  assert.deepEqual(result, {
    status: 200,
    json: [
      { id: 15, title: "Hypertask Product", sanitized: true },
      { id: 16, title: "Second board", sanitized: true },
    ],
  });
});

test("project listing without an active board retains full metadata", async () => {
  const calls = [];
  const prisma = {
    user: {
      findUnique: async () => ({ id: 6 }),
    },
    project: {
      findMany: async (args) => {
        calls.push(["projects", args]);
        return [{ id: 15, title: "Hypertask Product", members: [] }];
      },
      findFirst: async () => {
        throw new Error("inactive bootstrap must not query one active project");
      },
    },
  };
  const getAllProjects = loadController(prisma, calls);

  const result = await getAllProjects(6, 6);

  assert.deepEqual(calls.find(([name]) => name === "projects")[1], {
    where: { status: "Normal", OR: [{ ownerId: 6 }] },
    include: { members: true },
    orderBy: { id: "asc" },
  });
  assert.deepEqual(result.json, [
    { id: 15, title: "Hypertask Product", members: [], sanitized: true },
  ]);
});
