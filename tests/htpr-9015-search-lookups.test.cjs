const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

let routeReads = 0;
let projectReads = 0;
let projectThrows = false;

stubModule("src/lib/prisma.ts", {
  default: {
    project: {
      findMany: async () => {
        projectReads += 1;
        if (projectThrows) throw new Error("project lookup failed");
        return [{ teamId: "team-a" }];
      },
    },
  },
});
stubModule("src/app/api/ai/_lib/byokKeys.ts", {
  getTeamGatewayFunding: async () => {
    routeReads += 1;
    return undefined;
  },
  isOurGatewayKey: () => false,
  resolveTeamByokApiKey: async () => {
    routeReads += 1;
    return undefined;
  },
});
stubModule("src/app/api/ai/_lib/planAllowancePolicy.ts", {
  remainingSpendPathEnabled: async () => {
    routeReads += 1;
    return true;
  },
  resolveTeamAllowancePolicy: async () => {
    routeReads += 1;
    return { mode: "off" };
  },
});
stubModule("src/app/api/ai/_lib/sharedAllowance.ts", {
  reservePlanAllowance: async () => {
    throw new Error("charge is not part of the route lookup");
  },
  settlePlanAllowance: async () => {},
  teamAllowanceSnapshot: async () => {
    routeReads += 1;
    return null;
  },
  SharedAiAllowanceExceededError: class SharedAiAllowanceExceededError extends Error {},
});
stubModule("src/app/api/ai/_lib/planGate.ts", {
  storePlanIdForProject: async () => {
    routeReads += 1;
    return "pro";
  },
});
stubModule("src/lib/ai/spend/remainingSpend.ts", {
  embeddingCostUsd: () => 0,
  embeddingDecision: () => "keyword",
  upperBoundTokens: () => 1,
});

const jiti = require("jiti")(path.join(root, "tests/htpr-9015-search-lookups-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { embeddingSpendMode, resetEmbeddingSpendModeCacheForTests } = jiti(
  path.join(root, "src/lib/ai/spend/embeddingRoute.ts"),
);
const memoryContract = jiti(path.join(root, "src/app/api/ai/_lib/boardMemoryContract.ts"));

function moduleWithStubs(file, stubs) {
  const filename = path.join(root, file);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(code, {
    module: loadedModule,
    exports: loadedModule.exports,
    require: (id) => {
      if (id in stubs) return stubs[id];
      if (id.startsWith("@/") || id.startsWith("./")) return {};
      return require(id);
    },
    console: { log() {}, info() {}, warn() {}, error() {} },
  }, { filename });
  return loadedModule.exports;
}

test("one team route lookup serves the repeated searches for a minute", async () => {
  resetEmbeddingSpendModeCacheForTests();
  routeReads = 0;
  projectReads = 0;
  projectThrows = false;
  const first = await embeddingSpendMode([15]);
  const during = routeReads;
  const projects = projectReads;
  assert.equal(first.mode, "keyword");
  assert.equal(first.teamId, "team-a");
  assert.ok(during >= 4);
  assert.equal(projects, 1);
  await Promise.all([embeddingSpendMode([15]), embeddingSpendMode([15, 15])]);
  assert.equal(routeReads, during);
  assert.equal(projectReads, projects);
  const other = await embeddingSpendMode([16]);
  assert.equal(other.teamId, "team-a");
  assert.ok(routeReads > during);
  assert.equal(projectReads, 2);
});

test("a failed team lookup is not remembered", async () => {
  resetEmbeddingSpendModeCacheForTests();
  projectThrows = true;
  projectReads = 0;
  await assert.rejects(embeddingSpendMode([15]), /project lookup failed/);
  assert.equal(projectReads, 1);
  projectThrows = false;
  const recovered = await embeddingSpendMode([15]);
  assert.equal(recovered.mode, "keyword");
  assert.equal(projectReads, 2);
});

test("the remembered route expires after a minute", async (t) => {
  resetEmbeddingSpendModeCacheForTests();
  projectThrows = false;
  routeReads = 0;
  t.mock.timers.enable({ apis: ["Date"] });
  await embeddingSpendMode([], "team-a");
  const during = routeReads;
  t.mock.timers.tick(59_000);
  await embeddingSpendMode([], "team-a");
  assert.equal(routeReads, during);
  t.mock.timers.tick(1_000);
  await embeddingSpendMode([], "team-a");
  assert.ok(routeReads > during);
  t.mock.timers.reset();
});

test("board memory off does not list memory files", async () => {
  const listedTypes = [];
  let enabled = false;
  const memory = moduleWithStubs("src/app/api/ai/_lib/boardMemory.ts", {
    "@/app/api/ai/_lib/boardMemoryContract": memoryContract,
    "@/app/api/ai/_lib/customInstructions": {
      assertProjectAccess: async () => ({ id: 15, teamId: "team-a" }),
      ProjectAccessError: class ProjectAccessError extends Error {},
    },
    "@/utils/controllers/turbopuffer/turbopufferHelper": {
      listCustomInstructionFileRows: async ({ fileType }) => {
        listedTypes.push(fileType);
        if (enabled && fileType === memoryContract.BOARD_MEMORY_CONFIG_FILE_TYPE) {
          return [{ source: memoryContract.BOARD_MEMORY_CONFIG_SOURCE }];
        }
        return [];
      },
    },
    ai: { generateText: async () => { throw new Error("model"); }, Output: { object: () => ({}) } },
  });
  const state = await memory.getBoardMemoryState(6, 15);
  assert.equal(state.enabled, false);
  assert.equal(state.memories.length, 0);
  assert.deepEqual(listedTypes, [memoryContract.BOARD_MEMORY_CONFIG_FILE_TYPE]);
  enabled = true;
  listedTypes.length = 0;
  const on = await memory.getBoardMemoryState(6, 15);
  assert.equal(on.enabled, true);
  assert.deepEqual(listedTypes, [
    memoryContract.BOARD_MEMORY_CONFIG_FILE_TYPE,
    memoryContract.BOARD_MEMORY_FILE_TYPE,
  ]);
});

test("task writer reuses one ticket search for context and candidates", async () => {
  let searches = 0;
  let shared = false;
  const rows = [{ id: "9", projectId: 15, uniqueIndex: 9, title: "Cloth", descriptionText: "Kitchen", status: "Normal" }];
  const run = moduleWithStubs("src/app/api/ai/_lib/taskWriterRun.ts", {
    "@/lib/prisma": {
      __esModule: true,
      default: {
        project: { findFirst: async () => ({ id: 15, title: "Board", description: "", labels: [], section: [] }) },
        section: { findMany: async () => [] },
        task: { findMany: async () => [] },
        taskTemplate: { findMany: async () => [] },
      },
    },
    "@/lib/flags": { isFeatureEnabled: async () => false },
    "@/lib/systemModelLadder": { isAiFeatureEnabled: () => true },
    "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: () => ({}), taskWriteAccessWhere: () => ({}) },
    "@/lib/doneColumns": { doneColumnTitles: () => new Set() },
    "@/app/api/ai/_lib/providerGate": { getProjectTeamProviderContext: async () => ({ settings: {} }) },
    "@/app/api/ai/_lib/skills": { resolveSkills: async (text) => ({ cleanedText: text, systemPromptAddition: "", skills: [] }) },
    "@/app/api/ai/_lib/currentTaskContext": { loadCurrentTaskContext: async () => "", resolveAiUsageTaskId: async () => null },
    "@/app/api/ai/_lib/promptCache": { cachedInstructionsForUser: async () => "instructions" },
    "@/lib/rag/authorizeIndexedRows": { authorizeIndexedRows: async (tasks) => ({ taskRows: tasks, commentRows: [] }) },
    "@/utils/controllers/turbopuffer/turbopufferHelper": {
      searchTasks: async () => {
        searches += 1;
        return rows;
      },
    },
    "@/app/api/ai/_lib/taskWriterBoardResearch": {
      TASK_WRITER_BOARD_RESEARCH_WEB_RULES: "rules",
      TASK_WRITER_RELATED_CANDIDATE_LIMIT: 8,
      TASK_WRITER_STYLE_EXAMPLE_LIMIT: 3,
      buildTaskWriterRetrievalQuery: ({ prompt }) => prompt,
      formatRelatedTicketCandidates: (found) => `candidates:${found.map((row) => row.id).join(",")}`,
      formatBoardVocabulary: () => "",
      formatStyleExamples: () => "",
    },
    "@/app/api/ai/_lib/taskWriterPrompt": {
      formatTaskWriterRetrievedContext: (args) => args.relatedCandidates || "",
      createTaskWriterSystemPromptTemplate: () => "research",
      TASK_WRITER_RESEARCH_REQUEST_RULE: "",
      TASK_WRITER_TICKET_TYPE_RULE: "",
      TASK_WRITER_TICKET_TYPE_MARKER: "",
    },
    "@/app/api/ai/_lib/editorAi": {
      retrieveTaskWriterContext: async (args) => {
        shared = Boolean(args.taskSearch);
        if (args.taskSearch) await args.taskSearch;
        return "semantic";
      },
      createTaskWriterPromptParts: (args) => ({ instructions: "base", input: args.retrievedContext || "" }),
      createTaskWriterUserContent: (text) => text,
      createDocumentAttachmentSummary: () => "",
      extractImgSrcs: () => new Set(),
      selectTaskWriterModel: async () => ({ model: {}, modelId: "m", settings: {} }),
      createTaskAuthoringStyle: () => "style",
      TASK_AUTHORING_WEB_STYLE: "web",
    },
    "@/app/api/ai/_lib/boardTemplateContext": { BOARD_TEMPLATE_LIMIT: 10 },
  });
  const body = run.taskWriterRequestSchema.parse({ projectId: 15, PROMPT: "find the cloth", aiMode: "AiTaskWriter" });
  const prepared = await run.prepareTaskWriterRun(body, 6);
  assert.equal(searches, 1);
  assert.equal(shared, true);
  assert.equal(prepared.messages[0].content, "candidates:9");
  searches = 0;
  shared = false;
  const writing = run.taskWriterRequestSchema.parse({ projectId: 15, PROMPT: "find the cloth", aiMode: "WriteWithAI" });
  await run.prepareTaskWriterRun(writing, 6);
  assert.equal(searches, 0);
  assert.equal(shared, false);
  console.log("HTPR-9015 lookup proof ok");
});
