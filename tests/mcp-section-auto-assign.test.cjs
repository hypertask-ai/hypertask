const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function loadSectionServices({ memberCheck, agentOnBoard }) {
  const source = ts.transpileModule(
    read("src/lib/mcp/sections/services.ts"),
    {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  const updateCalls = [];
  const prisma = {
    project: {
      findFirst: async () => ({ id: 15 }),
    },
    section: {
      findFirst: async () => ({
        id: 4389,
        projectId: 15,
        deleted: false,
      }),
    },
  };
  const sectionService = {
    updateSection: async (input) => {
      updateCalls.push(input);
      return {
        status: 200,
        json: {
          id: 4389,
          section_title: "Bugs",
          projectId: 15,
          visibility: true,
          deleted: false,
          ranking: "A1",
          isDone: null,
          autoAssignUserId: input.autoAssignUserId ?? null,
          autoAssignAgentId: input.autoAssignAgentId ?? null,
        },
      };
    },
  };
  const mod = { exports: {} };
  new Function("module", "exports", "require", source)(
    mod,
    mod.exports,
    (request) => {
      const stubs = {
        "@/lib/prisma": prisma,
        "@/utils/controllers/projects/getAllIncludes": {
          getProjectWhere: () => ({}),
        },
        "@/utils/controllers/section/sectionService": sectionService,
        "@/lib/mcp/tasks/services": {
          validateProjectMemberIds: memberCheck,
        },
        "@/utils/controllers/agents/boardMembers": {
          isAgentOnBoard: agentOnBoard,
        },
      };
      return stubs[request] ?? require(request);
    },
  );
  return { ...mod.exports, updateCalls };
}

test("MCP section updates store and return a user auto-assignee", async () => {
  const service = loadSectionServices({
    memberCheck: async () => ({ invalidIds: [] }),
    agentOnBoard: async () => false,
  });

  const result = await service.updateSection({
    projectId: 15,
    sectionId: 4389,
    userId: 6,
    autoAssign: 6,
  });

  assert.equal(result.success, true);
  assert.equal(result.section.autoAssign, 6);
  assert.equal(service.updateCalls[0].autoAssignUserId, 6);
  assert.equal(service.updateCalls[0].autoAssignAgentId, null);
});

test("MCP section updates store and return an agent auto-assignee", async () => {
  const agentId = "33832850-a941-4a7e-922a-8751ce80197e";
  const service = loadSectionServices({
    memberCheck: async () => ({ invalidIds: [] }),
    agentOnBoard: async (_projectId, candidate) => candidate === agentId,
  });

  const result = await service.updateSection({
    projectId: 15,
    sectionId: 4389,
    userId: 6,
    autoAssign: agentId,
  });

  assert.equal(result.success, true);
  assert.equal(result.section.autoAssign, agentId);
  assert.equal(service.updateCalls[0].autoAssignUserId, null);
  assert.equal(service.updateCalls[0].autoAssignAgentId, agentId);
});

test("MCP section updates clear both auto-assignee fields", async () => {
  const service = loadSectionServices({
    memberCheck: async () => ({ invalidIds: [] }),
    agentOnBoard: async () => false,
  });

  const result = await service.updateSection({
    projectId: 15,
    sectionId: 4389,
    userId: 6,
    autoAssign: null,
  });

  assert.equal(result.success, true);
  assert.equal(result.section.autoAssign, null);
  assert.equal(service.updateCalls[0].autoAssignUserId, null);
  assert.equal(service.updateCalls[0].autoAssignAgentId, null);
});

test("MCP section updates reject auto-assignees outside the board", async () => {
  const userService = loadSectionServices({
    memberCheck: async () => ({ invalidIds: [42] }),
    agentOnBoard: async () => false,
  });
  const userResult = await userService.updateSection({
    projectId: 15,
    sectionId: 4389,
    userId: 6,
    autoAssign: 42,
  });
  assert.equal(userResult.success, false);
  assert.equal(userResult.status, 400);
  assert.equal(userService.updateCalls.length, 0);

  const agentService = loadSectionServices({
    memberCheck: async () => ({ invalidIds: [] }),
    agentOnBoard: async () => false,
  });
  const agentResult = await agentService.updateSection({
    projectId: 15,
    sectionId: 4389,
    userId: 6,
    autoAssign: "deleted-agent",
  });
  assert.equal(agentResult.success, false);
  assert.equal(agentResult.status, 400);
  assert.equal(agentService.updateCalls.length, 0);
});

test("MCP section list and update routes expose autoAssign", () => {
  const listRoute = read("src/app/api/mcp/projects/[projectId]/sections/route.ts");
  const updateRoute = read(
    "src/app/api/mcp/projects/[projectId]/sections/[sectionId]/route.ts",
  );

  assert.match(listRoute, /autoAssignUserId: true/);
  assert.match(listRoute, /autoAssignAgentId: true/);
  assert.match(listRoute, /autoAssign: section\.autoAssignAgentId \?\? section\.autoAssignUserId \?\? null/);
  assert.match(updateRoute, /['"]auto_assign['"] in body/);
  assert.match(updateRoute, /isDone,\s*autoAssign/);
});
