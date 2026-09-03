const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
  moduleCache: false,
});
const {
  applySectionAutoAssignToProject,
  hasNoSectionAutoAssign,
  sectionAutoAssignTargetFor,
  syncSectionAutoAssignFromCanonical,
} = jiti(path.join(root, "src/lib/sectionAutoAssign.ts"));
const { getActiveColumnsViewFromProject } = jiti(
  path.join(
    root,
    "src/utils/helperFunctions/Views/ViewsHelperFunctions.ts",
  ),
);

test("column auto-assign targets are mutually exclusive", () => {
  assert.deepEqual(sectionAutoAssignTargetFor({ id: 42 }), {
    autoAssignAgentId: null,
    autoAssignUserId: 42,
  });
  assert.deepEqual(sectionAutoAssignTargetFor({ id: "agent-42" }), {
    autoAssignAgentId: "agent-42",
    autoAssignUserId: null,
  });
  assert.deepEqual(sectionAutoAssignTargetFor({ id: 0 }), {
    autoAssignAgentId: null,
    autoAssignUserId: null,
  });
});

test("clear is selected only when neither a person nor agent is configured", () => {
  assert.equal(
    hasNoSectionAutoAssign({
      autoAssignAgentId: null,
      autoAssignUserId: null,
    }),
    true,
  );
  assert.equal(
    hasNoSectionAutoAssign({
      autoAssignAgentId: "agent-42",
      autoAssignUserId: null,
    }),
    false,
  );
  assert.equal(
    hasNoSectionAutoAssign({
      autoAssignAgentId: null,
      autoAssignUserId: 42,
    }),
    false,
  );
});

test("stale column views use the canonical auto-assignee", () => {
  assert.deepEqual(
    syncSectionAutoAssignFromCanonical(
      {
        id: 4307,
        section_title: "Features",
        autoAssignAgentId: null,
        autoAssignUserId: null,
      },
      {
        id: 4307,
        section_title: "Features",
        autoAssignAgentId: "agent-desktop-developer",
        autoAssignUserId: null,
      },
    ),
    {
      id: 4307,
      section_title: "Features",
      autoAssignAgentId: "agent-desktop-developer",
      autoAssignUserId: null,
    },
  );

  assert.deepEqual(
    syncSectionAutoAssignFromCanonical(
      {
        id: 4307,
        section_title: "Features",
        autoAssignAgentId: "stale-agent",
        autoAssignUserId: null,
      },
      {
        id: 4307,
        section_title: "Features",
        autoAssignAgentId: null,
        autoAssignUserId: null,
      },
    ),
    {
      id: 4307,
      section_title: "Features",
      autoAssignAgentId: null,
      autoAssignUserId: null,
    },
  );

  const [features] = getActiveColumnsViewFromProject({
    id: 15,
    section: [
      {
        id: 4307,
        section_title: "Features",
        ranking: "A1",
        autoAssignAgentId: "agent-desktop-developer",
        autoAssignUserId: null,
      },
    ],
    project_view: {
      default_view: {
        board_columns_view: [
          {
            id: 4307,
            section_title: "Features",
            ranking: "A1",
          },
        ],
      },
      user_project_views: [],
    },
  });
  assert.equal(features.autoAssignAgentId, "agent-desktop-developer");
  assert.equal(features.autoAssignUserId, null);
});

test("saved auto-assignment updates every snapshot of only the target column", () => {
  const target = {
    id: 4307,
    section_title: "Features",
    autoAssignAgentId: null,
    autoAssignUserId: 6,
  };
  const untouched = {
    id: 4308,
    section_title: "Bugs",
    autoAssignAgentId: "bug-agent",
    autoAssignUserId: null,
  };
  const project = {
    id: 15,
    section: [target, untouched],
    sections: [{ ...target }, { ...untouched }],
    filteredSections: [{ ...target }, { ...untouched }],
  };

  const updated = applySectionAutoAssignToProject(project, 15, 4307, {
    autoAssignAgentId: "desktop-agent",
    autoAssignUserId: null,
  });

  for (const key of ["section", "sections", "filteredSections"]) {
    assert.deepEqual(updated[key][0], {
      ...target,
      autoAssignAgentId: "desktop-agent",
      autoAssignUserId: null,
    });
    assert.deepEqual(updated[key][1], untouched);
  }
  assert.equal(project.section[0].autoAssignUserId, 6);
  const otherProject = { id: 16 };
  assert.strictEqual(
    applySectionAutoAssignToProject(otherProject, 15, 4307, {
      autoAssignAgentId: "desktop-agent",
      autoAssignUserId: null,
    }),
    otherProject,
  );
});

test("column auto-assign stores either a person or a board agent", () => {
  const schema = read("src/prisma/schema.prisma");
  const route = read("src/app/api/sections/auto-assign/route.ts");
  const controller = read("src/utils/controllers/assignees/autoAssignForSection.ts");
  const migration = read(
    "src/prisma/migrations/20260810110000_add_section_auto_assign_agent/migration.sql",
  );

  assert.match(schema, /autoAssignAgentId\s+String\?/);
  assert.equal(
    migration.trim(),
    'ALTER TABLE "Section" ADD COLUMN "autoAssignAgentId" TEXT;',
  );
  assert.match(route, /autoAssignUserId !== null && autoAssignAgentId !== null/);
  assert.match(route, /isAgentOnBoard\(section\.projectId, autoAssignAgentId\)/);
  assert.match(route, /data: \{ autoAssignUserId, autoAssignAgentId \}/);
  assert.match(
    controller,
    /select: \{[\s\S]*projectId: true,[\s\S]*deleted: true,[\s\S]*autoAssignAgentId: true,[\s\S]*autoAssignUserId: true/,
  );
  assert.match(controller, /autoAssignUserId \?\? null/);
  assert.match(controller, /autoAssignAgentId \?\? undefined/);
});

test("moving into an agent-configured section uses the agent-only assignment path", async () => {
  const compile = (file) => ts.transpileModule(read(file), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const load = (javascript, stubs) => {
    const mod = { exports: {} };
    new Function("module", "exports", "require", javascript)(
      mod,
      mod.exports,
      (request) => stubs[request] ?? require(request),
    );
    return mod.exports;
  };
  const assignedOwnerIds = [];
  const prisma = {
    section: {
      findUnique: async () => ({
        projectId: 15,
        deleted: false,
        autoAssignAgentId: "agent-42",
        autoAssignUserId: null,
      }),
    },
    task: {
      findUnique: async () => ({
        id: 5272,
        projectId: 15,
        title: "Agent auto-assignment",
        sectionId: 99,
        status: "Normal",
      }),
    },
    agent: {
      findFirst: async () => ({ userId: 77 }),
    },
    assignees: {
      findFirst: async () => ({ id: 1 }),
      findMany: async () => [{ id: 1, userId: 77, agentId: "agent-42" }],
    },
    subscribedDevices: {
      findMany: async ({ where }) => {
        assignedOwnerIds.push(where.userId);
        return [];
      },
    },
  };
  const assignStubs = {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/models/model": {},
    "../FCM": {},
    "../activities/createAssignedActivity": {
      __esModule: true,
      assignmentActivityUserSelect: {},
      default: () => {},
    },
    "../notifications/creation-service/check-reminder_create-notification": {
      __esModule: true,
      default: async () => {},
    },
    "../notifications/agentActionRecipients": {
      shouldSkipSelfAssign: () => false,
    },
    "../notifications/sendAssignEmail": { sendAssignEmail: async () => {} },
    "@/utils": { taskBaseUri: "https://app.hypertask.ai/detail/" },
    "@/utils/controllers/agents/boardMembers": {
      isAgentOnBoard: async () => true,
    },
    "@/lib/mcp/tasks/services": {
      validateProjectMemberIds: async () => ({ invalidIds: [] }),
    },
    "@/lib/agents/publicAgent": { publicAgentSelect: {} },
    "@/lib/agentWebhooks/outbox": {
      persistAgentWebhookEvent: async () => null,
      publishAgentWebhookDeliveries: async () => {},
    },
    "@/lib/mcp/webhooks/outbox": {
      persistBoardWebhookEvent: async () => null,
      publishBoardWebhookDeliveries: async () => {},
    },
    "@/lib/mcp/tasks/agentMutationFence": {
      AgentMutationLeaseConflictError: class extends Error {},
      assertAgentAssignmentChangeAllowed: async () => {},
    },
  };
  const { default: assign } = load(
    compile("src/utils/controllers/assignees/assign.ts"),
    assignStubs,
  );
  const controllerStubs = {
    "@/lib/prisma": {
      __esModule: true,
      default: prisma,
    },
    "./assign": {
      __esModule: true,
      default: assign,
    },
  };
  const { autoAssignForSection } = load(
    compile("src/utils/controllers/assignees/autoAssignForSection.ts"),
    controllerStubs,
  );

  const currentUser = { id: 6 };
  await autoAssignForSection({
    taskId: 5272,
    projectId: 15,
    sectionId: 99,
    currentUser,
  });

  assert.deepEqual(assignedOwnerIds, [77]);
});

test("every column auto-assign entry point exposes agents and preserves selection", () => {
  const picker = read("src/components/Modals/AssignToUser/AssignToUser.tsx");
  const command = read("src/components/Modals/commands/autoAssignColumn.tsx");
  const settings = read("src/components/Modals/Settings/BoardGeneralSection.tsx");
  const manage = read("src/components/Modals/commands/manageColumn.tsx");

  assert.match(picker, /selectedAgentIds\?: string\[\]/);
  assert.match(picker, /assigned: selectedAgentIds\.includes\(agent\.id\)/);
  for (const source of [command, settings, manage]) {
    assert.match(source, /includeAgents/);
    assert.match(source, /selectedAgentIds=/);
    assert.match(source, /autoAssignAgentId/);
  }
  for (const source of [settings, manage]) {
    assert.match(source, /boardAgents\?: IAgent\[\]/);
    assert.doesNotMatch(source, /useAgents/);
  }
  assert.match(settings, /hasNoSectionAutoAssign/);
  assert.match(manage, /saveAgentAutoAssign/);
  assert.match(manage, /hasNoSectionAutoAssign/);
  assert.match(
    read("src/utils/helperFunctions/Views/ViewsHelperFunctions.ts"),
    /syncSectionAutoAssignFromCanonical\(column, section\)/,
  );
});

test("manage columns keeps its settings-row autosave behavior", () => {
  const manage = read("src/components/Modals/commands/manageColumn.tsx");

  assert.match(manage, /One row per setting, matching the Settings board rows/);
  assert.match(manage, /onBlur=\{isMobile \? undefined : saveTitleOnBlur\}/);
  assert.match(manage, /queueSave\(\(\) =>/);
  assert.match(manage, /inputId="edit-column-is-done"/);
  assert.match(manage, />\s*Danger zone\s*</);
});

test("command toast treats an agent target as updated, not cleared", () => {
  const commands = read("src/components/commands.tsx");

  assert.match(
    commands,
    /autoAssignUserId == null && autoAssignAgentId == null\s*\? "Column auto-assign cleared"/,
  );
  assert.match(
    commands,
    /setQueryData<IProject\[\]>\(\["projectsAllMinimal"\], \(current\) =>\s*current\?\.map\(updateProject\)/,
  );
});

test("manage-column auto-assign saves update the editor query cache", () => {
  const manage = read("src/components/Modals/commands/manageColumn.tsx");
  const projectCacheBlockStart = manage.indexOf(
    "const updateProjectAutoAssignCaches",
  );
  const saveBlockStart = manage.indexOf("const saveAutoAssign");
  const saveBlockEnd = manage.indexOf("const autoAssignName");
  assert.ok(projectCacheBlockStart >= 0, "the project-cache helper must exist");
  assert.ok(saveBlockStart >= 0, "the auto-assign save block must exist");
  assert.ok(
    saveBlockStart > projectCacheBlockStart,
    "the project-cache helper must precede the save paths",
  );
  assert.ok(saveBlockEnd > saveBlockStart, "the save block end must exist");
  const projectCacheBlock = manage.slice(projectCacheBlockStart, saveBlockStart);
  const saveBlock = manage.slice(saveBlockStart, saveBlockEnd);

  assert.match(manage, /updateManageColumnsAutoAssignCache/);
  assert.match(manage, /globalConstants\.GetAllManageColumnsPrefixKey/);
  assert.match(
    manage,
    /updateManageColumnsAutoAssignCache\(\s*projectId,\s*sectionId,\s*autoAssignUserId,\s*null/,
  );
  assert.match(
    manage,
    /updateManageColumnsAutoAssignCache\(\s*projectId,\s*sectionId,\s*null,\s*autoAssignAgentId/,
  );
  assert.equal(
    saveBlock.match(/setEditSection\(\(current\)/g)?.length,
    2,
    "both save paths merge into the latest editor state",
  );
  assert.equal(
    saveBlock.match(/current\?\.id === sectionId/g)?.length,
    2,
    "a completed save updates only the column that started it",
  );
  assert.equal(
    projectCacheBlock.match(/setCurrentProject|setQueryData|setQueriesData/g)?.length,
    3,
    "the open board and both project-query families receive the saved rule",
  );
  assert.match(
    projectCacheBlock,
    /applySectionAutoAssignToProject\(project, projectId, sectionId/,
  );
  assert.match(projectCacheBlock, /setQueryData<IProjectsAll>\(\["projectsAll"\]/);
  assert.match(
    projectCacheBlock,
    /setQueriesData<IProject\[\]>\(\s*\{ queryKey: \["projectsAllMinimal"\] \}/,
  );
  assert.equal(
    projectCacheBlock.match(/queryClient\.cancelQueries/g)?.length,
    2,
    "both project-query families stop before their caches are patched",
  );
  assert.equal(
    saveBlock.match(/await updateProjectAutoAssignCaches\(/g)?.length,
    2,
    "both save paths patch the active project caches",
  );
  assert.doesNotMatch(saveBlock, /queryClient\.invalidateQueries/);
  assert.doesNotMatch(saveBlock, /setEditSection\(\{\s*\.\.\.editSection/);
});

test("manage columns replaces its editor modal with the auto-assignee picker", () => {
  const manage = read("src/components/Modals/commands/manageColumn.tsx");
  const pickerReturn = manage.indexOf(
    "if (assignOpen && currentProject && editSection && assignSectionId)",
  );
  const editorReturn = manage.indexOf("return (\n    <ModalContainerCustom");

  assert.ok(pickerReturn >= 0, "the picker has its own render branch");
  assert.ok(
    pickerReturn < editorReturn,
    "the picker replaces the editor before its modal mounts",
  );
  assert.match(
    manage.slice(pickerReturn, editorReturn),
    /return \(\s*<AssignModal/,
    "the picker branch renders the assignee picker",
  );
  assert.equal(
    manage.slice(pickerReturn, editorReturn).match(/void queueSave\(\(\) =>/g)
      ?.length,
    2,
    "person and agent saves share the same queue",
  );
  assert.match(
    manage.slice(pickerReturn, editorReturn),
    /saveAgentAutoAssign\(\s*assignProjectId,\s*assignSectionId/,
  );
  assert.match(
    manage.slice(pickerReturn, editorReturn),
    /saveAutoAssign\(\s*assignProjectId,\s*assignSectionId/,
  );
  assert.doesNotMatch(
    manage.slice(editorReturn),
    /assignOpen[\s\S]*?<AssignModal/,
    "the editor modal must not contain a nested Reactstrap modal",
  );
});

test("creating a task in an agent-configured column auto-assigns the agent", async () => {
  const compile = (file) => ts.transpileModule(read(file), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const load = (javascript, stubs) => {
    const mod = { exports: {} };
    new Function("module", "exports", "require", javascript)(
      mod,
      mod.exports,
      (request) => stubs[request] ?? require(request),
    );
    return mod.exports;
  };

  const assignCalls = [];
  let assignmentResponse = { status: 200, json: {} };
  const prisma = {
    task: {
      findUnique: async ({ where }) => {
        assert.deepEqual(where, { id: 5488 });
        return {
          projectId: 15,
          sectionId: 99,
          status: "Normal",
        };
      },
    },
    section: {
      findUnique: async () => ({
        projectId: 15,
        deleted: false,
        autoAssignAgentId: "agent-42",
        autoAssignUserId: null,
      }),
    },
    // Creation paths carry only the acting user's id, so the controller has to
    // load the real record before assign writes the activity and notification.
    user: {
      findUnique: async ({ where }) =>
        where.id === 6
          ? {
              id: 6,
              email: "valentin@hypertask.ai",
              displayName: "Valentin Yeo",
              photoURL: null,
            }
          : null,
    },
  };
  const { autoAssignForSection } = load(
    compile("src/utils/controllers/assignees/autoAssignForSection.ts"),
    {
      "@/lib/prisma": { __esModule: true, default: prisma },
      "./assign": {
        __esModule: true,
        default: async (currentUser, userId, taskId, agentId) => {
          assignCalls.push({ currentUser, userId, taskId, agentId });
          return assignmentResponse;
        },
      },
    },
  );

  await autoAssignForSection({
    taskId: 5488,
    projectId: 15,
    sectionId: 99,
    currentUserId: 6,
  });

  assert.equal(assignCalls.length, 1);
  assert.equal(assignCalls[0].agentId, "agent-42");
  assert.equal(assignCalls[0].taskId, 5488);
  assert.equal(assignCalls[0].currentUser.displayName, "Valentin Yeo");

  assignmentResponse = {
    status: 400,
    json: { message: "Agent is not a member of this board." },
  };
  assert.equal(
    await autoAssignForSection({
      taskId: 5488,
      projectId: 15,
      sectionId: 99,
      currentUserId: 6,
    }),
    "ready",
  );

  assignmentResponse = {
    status: 500,
    json: { message: "Internal server error" },
  };
  assert.equal(
    await autoAssignForSection({
      taskId: 5488,
      projectId: 15,
      sectionId: 99,
      currentUserId: 6,
    }),
    "pending",
  );

  // An unknown acting user must not fall through to assign with a stub record.
  assignCalls.length = 0;
  await autoAssignForSection({
    taskId: 5488,
    projectId: 15,
    sectionId: 99,
    currentUserId: 999,
  });
  assert.equal(assignCalls.length, 0);
});

test("a missing task does not trigger column auto-assignment", async () => {
  const compile = (file) => ts.transpileModule(read(file), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const load = (javascript, stubs) => {
    const mod = { exports: {} };
    new Function("module", "exports", "require", javascript)(
      mod,
      mod.exports,
      (request) => stubs[request] ?? require(request),
    );
    return mod.exports;
  };
  const prisma = {
    task: { findUnique: async () => null },
    section: { findUnique: async () => null },
  };
  let assignCalls = 0;
  const { autoAssignForSection } = load(
    compile("src/utils/controllers/assignees/autoAssignForSection.ts"),
    {
      "@/lib/prisma": { __esModule: true, default: prisma },
      "./assign": {
        __esModule: true,
        default: async () => {
          assignCalls += 1;
          return { status: 200, json: {} };
        },
      },
    },
  );

  assert.equal(
    await autoAssignForSection({
      taskId: 9999,
      projectId: 15,
      sectionId: 99,
      currentUserId: 6,
    }),
    "ready",
  );
  assert.equal(assignCalls, 0);
});

test("an archived task does not trigger column auto-assignment", async () => {
  const compile = (file) => ts.transpileModule(read(file), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const load = (javascript, stubs) => {
    const mod = { exports: {} };
    new Function("module", "exports", "require", javascript)(
      mod,
      mod.exports,
      (request) => stubs[request] ?? require(request),
    );
    return mod.exports;
  };
  let sectionReads = 0;
  let assignCalls = 0;
  const prisma = {
    task: {
      findUnique: async () => ({
        projectId: 15,
        sectionId: 99,
        status: "Archive",
      }),
    },
    section: {
      findUnique: async () => {
        sectionReads += 1;
        return {
          projectId: 15,
          deleted: false,
          autoAssignAgentId: "agent-42",
          autoAssignUserId: null,
        };
      },
    },
  };
  const { autoAssignForSection } = load(
    compile("src/utils/controllers/assignees/autoAssignForSection.ts"),
    {
      "@/lib/prisma": { __esModule: true, default: prisma },
      "./assign": {
        __esModule: true,
        default: async () => {
          assignCalls += 1;
          return { status: 200, json: {} };
        },
      },
    },
  );

  assert.equal(
    await autoAssignForSection({
      taskId: 9998,
      projectId: 15,
      sectionId: 99,
      currentUserId: 6,
    }),
    "ready",
  );
  assert.equal(sectionReads, 0);
  assert.equal(assignCalls, 0);
});

test("every task creation path runs the column auto-assign rule", () => {
  const boardCreate = read("src/utils/controllers/tasks/create.ts");
  const globalCreate = read("src/pages/api/tasks/createGlobally.ts");
  const core = read("src/utils/controllers/tasks/createTaskCore.ts");

  for (const source of [boardCreate, globalCreate, core]) {
    assert.match(source, /autoAssignForSection/);
    assert.match(source, /currentUserId/);
  }
  // The board broadcast waits for the assignment so other viewers receive the
  // task with its auto-assignee already attached.
  assert.match(
    globalCreate,
    /const autoAssignWork = import\("@\/utils\/controllers\/assignees\/autoAssignForSection"\)[\s\S]*?autoAssignWork\.then\(async \(\) => \{[\s\S]*?broadcastBoardChange/,
  );
  assert.match(globalCreate, /const autoAssignWork = import\("@\/utils\/controllers\/assignees\/autoAssignForSection"\)[\s\S]*?const agentWebhookWork = autoAssignWork[\s\S]*?emitAgentTaskCreatedWebhook/);
});
