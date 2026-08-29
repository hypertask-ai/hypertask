const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function loadController(prisma, calls) {
  const source = fs.readFileSync(
    path.join(root, "src/utils/controllers/projects/getBoardTasks.ts"),
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
      getBoardTaskInclude: (options) => {
        calls.push(["board-task-include", options]);
        return { notifications: { where: { userId: options.userDbId } } };
      },
      getProjectIncludeWithoutTasks: (options) => {
        calls.push(["project-include", options]);
        return { sections: true };
      },
      getProjectViewInclude: (options) => {
        calls.push(["view-include", options]);
        return { include: { default_view: true } };
      },
      getProjectWhere: (userId) => {
        calls.push(["project-where", userId]);
        return { OR: [{ ownerId: userId }] };
      },
      getTaskWhere: () => ({ status: "Normal" }),
      taskBoardOmit: { description: true },
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

test("board payload checks access before querying task content", async () => {
  const calls = [];
  const project = {
    id: 15,
    project_view: {
      id: "project-view-15",
      default_view: { id: "default-view" },
      allViews: ["my-view"],
    },
  };
  const prisma = {
    project: {
      findFirst: async (args) => {
        calls.push(["project", args]);
        return project;
      },
    },
    task: {
      findMany: async (args) => {
        calls.push(["tasks", args]);
        return [{ id: 101 }];
      },
    },
  };
  const getBoardTasks = loadController(prisma, calls);

  const result = await getBoardTasks("15", "6", 6);

  assert.deepEqual(
    calls.filter(([name]) => name === "project" || name === "tasks").map(([name]) => name),
    ["project", "tasks"],
  );
  assert.deepEqual(calls.find(([name]) => name === "project")[1].where, {
    id: 15,
    status: "Normal",
    OR: [{ ownerId: 6 }],
  });
  assert.deepEqual(calls.find(([name]) => name === "board-task-include")[1], {
    userId: 6,
    userDbId: 6,
    currentUserId: 6,
  });
  assert.deepEqual(result, {
    status: 200,
    json: {
      project: {
        id: 15,
        project_view: {
          id: "project-view-15",
          default_view: { id: "default-view" },
        },
        sanitized: true,
      },
      tasks: [{ id: 101 }],
      allViews: ["my-view"],
    },
  });
  assert.deepEqual(
    calls.find(([name]) => name === "project")[1].include.project_view,
    { include: { default_view: true } },
  );
  assert.deepEqual(project.project_view.allViews, ["my-view"]);
});

test("denied board access never queries task content", async () => {
  const calls = [];
  const prisma = {
    project: {
      findFirst: async () => {
        calls.push(["project"]);
        return null;
      },
    },
    task: {
      findMany: async () => {
        calls.push(["tasks"]);
        return [];
      },
    },
  };
  const getBoardTasks = loadController(prisma, calls);

  const result = await getBoardTasks(15, 6, 6);

  assert.deepEqual(result, {
    status: 403,
    json: { message: "No access to this board" },
  });
  assert.equal(calls.some(([name]) => name === "tasks"), false);
});

test("invalid identifiers stop before any database query", async () => {
  const calls = [];
  const prisma = {
    project: {
      findFirst: async () => {
        calls.push(["project"]);
        return null;
      },
    },
    task: {
      findMany: async () => {
        calls.push(["tasks"]);
        return [];
      },
    },
  };
  const getBoardTasks = loadController(prisma, calls);

  const result = await getBoardTasks("not-a-project", 6, 6);

  assert.deepEqual(result, {
    status: 400,
    json: { message: "projectId and userId are required" },
  });
  assert.deepEqual(calls, []);
});
