const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const FLAG = "htpr-9015-search-lookups";
let routeReads = 0;
let projectReads = 0;
let projectThrows = false;
let lookupsOn = true;
let listedTypes = [];
let memoryOn = false;
let searches = 0;
const bump = (slot) => async () => { slot === "route" ? routeReads += 1 : projectReads += 1; if (slot === "project" && projectThrows) throw new Error("project lookup failed"); return slot === "project" ? [{ teamId: "team-a" }] : undefined; };

const route = loadModule("src/lib/ai/spend/embeddingRoute.ts", {
  "@/lib/flags": { isFeatureEnabled: async (key) => key === FLAG && lookupsOn },
  "@/lib/prisma": { default: { project: { findMany: bump("project") } } },
  "@/app/api/ai/_lib/byokKeys": {
    getTeamGatewayFunding: bump("route"),
    isOurGatewayKey: () => false,
    resolveTeamByokApiKey: bump("route"),
  },
  "@/app/api/ai/_lib/planAllowancePolicy": {
    remainingSpendPathEnabled: async () => { routeReads += 1; return true; },
    resolveTeamAllowancePolicy: async () => { routeReads += 1; return { mode: "off" }; },
  },
  "@/app/api/ai/_lib/sharedAllowance": {
    reservePlanAllowance: async () => { throw new Error("charge is not part of the route lookup"); },
    settlePlanAllowance: async () => {},
    teamAllowanceSnapshot: async () => null,
    SharedAiAllowanceExceededError: class SharedAiAllowanceExceededError extends Error {},
  },
  "@/app/api/ai/_lib/planGate": { storePlanIdForProject: async () => { routeReads += 1; return "pro"; } },
  "@/lib/ai/spend/remainingSpend": { embeddingCostUsd: () => 0, embeddingDecision: () => "keyword", upperBoundTokens: () => 1 },
});

const memory = loadModule("src/app/api/ai/_lib/boardMemory.ts", {
  "@/lib/flags": { isFeatureEnabled: async (key) => key === FLAG && lookupsOn },
  "@/lib/net/downloadWithoutBrotli": { downloadWithoutBrotli: async () => { throw new Error("download"); } },
  "@/app/api/ai/_lib/modelProvider": {
    resolveAiModel: () => "memory-model", configureAiModelUsage() {},
    aiUsageProviderForCredential: () => "gateway", gatewayProviderOptionsForModel: () => ({}),
  },
  "@/lib/aiModelOptions": { defaultModelKeyFor: () => "gpt-6-luna" },
  "@/app/api/ai/_lib/byokKeys": {
    getAiDefaultModelContext: async () => ({}), resolveAutomaticAiModel: () => "memory-model",
    getByokOrTeamGatewayApiKeyForProvider: async () => undefined,
  },
  "@/lib/ai/prompts/registry": { renderPrompt: () => "" },
  ai: { generateText: async () => { throw new Error("model"); }, Output: { object: () => ({}) } },
  "@/app/api/ai/_lib/customInstructions": {
    assertProjectAccess: async () => ({ id: 15, teamId: "team-a" }),
    ProjectAccessError: class ProjectAccessError extends Error {},
  },
  "@/app/api/ai/_lib/boardMemoryGuards": {
    BoardMemoryBusyError: class BoardMemoryBusyError extends Error {},
    bumpBoardMemoryRevision: async () => 1, claimBoardMemorySignal: async () => ({ status: "claimed", token: "t" }),
    completeBoardMemorySignalClaim: async () => {}, getBoardMemoryRevision: async () => 0,
    releaseBoardMemorySignalClaim: async () => {},
    withBoardMemoryLock: async (_id, fn) => fn({ assertCurrent: async () => {} }),
  },
  "@/utils/controllers/turbopuffer/turbopufferHelper": {
    buildCustomInstructionFileRows: () => [], deleteCustomInstructionFileInTurbopuffer: async () => {},
    upsertCustomInstructionFileRowsToTurbopuffer: async () => {},
    listCustomInstructionFileRows: async ({ fileType }) => {
      listedTypes.push(fileType);
      if (memoryOn && String(fileType).endsWith("config")) return [{ source: "hypertask-memory:config" }];
      return [];
    },
  },
});

const rows = [{ id: "9", projectId: 15, uniqueIndex: 9, title: "Cloth", descriptionText: "Kitchen", status: "Normal" }];
const writer = loadModule("src/app/api/ai/_lib/taskWriterRun.ts", {
  "@/lib/flags/keys": {},
  "@/lib/flags": {
    isFeatureEnabled: async (key) => key === FLAG && lookupsOn,
    HTPR_7060_TASK_WRITER_EMPTY_AND_RESEARCH_FLAG: "htpr-7060",
    HTPR_7057_WRITER_HEADING_LANGUAGE_FLAG: "htpr-7057",
    HTPR_7123_WRITER_TICKET_TYPE_FLAG: "htpr-7123",
  },
  "@/lib/prisma": { default: {
    project: { findFirst: async () => ({ id: 15, title: "Board", description: "", labels: [], section: [] }) },
    section: { findMany: async () => [] }, task: { findMany: async () => [] }, taskTemplate: { findMany: async () => [] },
  } },
  "@/lib/systemModelLadder": { isAiFeatureEnabled: () => true },
  "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: () => ({}), taskWriteAccessWhere: () => ({}) },
  "@/lib/doneColumns": { doneColumnTitles: () => new Set() },
  "@/lib/ai/composeTaskTarget": { isEmptyComposeTarget: () => false },
  "@/lib/ai/taskWriterDueDate": { taskWriterDateContext: () => null, taskWriterDueDateInstructions: () => "" },
  "@/lib/ai/prompts/registry": { renderPrompt: () => "" },
  "@/app/api/ai/_lib/providerGate": { getProjectTeamProviderContext: async () => ({ settings: {} }) },
  "@/app/api/ai/_lib/skills": { resolveSkills: async (text) => ({ cleanedText: text, systemPromptAddition: "", skills: [] }) },
  "@/app/api/ai/_lib/currentTaskContext": { loadCurrentTaskContext: async () => "", resolveAiUsageTaskId: async () => null },
  "@/app/api/ai/_lib/promptCache": { cachedInstructionsForUser: async () => "instructions" },
  "@/lib/rag/authorizeIndexedRows": { authorizeIndexedRows: async (tasks) => ({ taskRows: tasks, commentRows: [] }) },
  "@/utils/controllers/turbopuffer/turbopufferHelper": { searchTasks: async () => { searches += 1; return rows; } },
  "@/app/api/ai/_lib/taskWriterBoardResearch": {
    TASK_WRITER_BOARD_RESEARCH_WEB_RULES: "rules", TASK_WRITER_RELATED_CANDIDATE_LIMIT: 8, TASK_WRITER_STYLE_EXAMPLE_LIMIT: 3,
    buildTaskWriterRetrievalQuery: ({ prompt }) => prompt,
    formatRelatedTicketCandidates: (found) => `candidates:${found.map((row) => row.id).join(",")}`,
    formatBoardVocabulary: () => "", formatStyleExamples: () => "",
  },
  "@/app/api/ai/_lib/taskWriterPrompt": {
    formatTaskWriterRetrievedContext: (args) => args.relatedCandidates || "",
    createTaskWriterSystemPromptTemplate: () => "research",
    TASK_WRITER_RESEARCH_REQUEST_RULE: "", TASK_WRITER_TICKET_TYPE_RULE: "", TASK_WRITER_TICKET_TYPE_MARKER: "",
  },
  "@/app/api/ai/_lib/editorAi": {
    retrieveTaskWriterContext: async (args) => { if (args.taskSearch) await args.taskSearch; else searches += 1; return "semantic"; },
    createTaskWriterPromptParts: (args) => ({ instructions: "base", input: args.retrievedContext || "" }),
    createTaskWriterUserContent: (text) => text, createDocumentAttachmentSummary: () => "",
    extractImgSrcs: () => new Set(), selectTaskWriterModel: async () => ({ model: {}, modelId: "m", settings: {} }),
    createTaskAuthoringStyle: () => "style", TASK_AUTHORING_WEB_STYLE: "web",
  },
  "@/app/api/ai/_lib/boardTemplateContext": { BOARD_TEMPLATE_LIMIT: 10 },
});

test("one team route lookup serves the repeated searches for a minute", async (t) => {
  lookupsOn = true;
  route.resetEmbeddingSpendModeCacheForTests();
  routeReads = 0; projectReads = 0; projectThrows = false;
  const first = await route.embeddingSpendMode([15]);
  const during = routeReads;
  assert.equal(first.mode, "keyword");
  assert.equal(first.teamId, "team-a");
  assert.ok(during >= 4);
  assert.equal(projectReads, 1);
  await Promise.all([route.embeddingSpendMode([15]), route.embeddingSpendMode([15, 15])]);
  assert.equal(routeReads, during);
  assert.equal(projectReads, 1);
  t.mock.timers.enable({ apis: ["Date"] });
  routeReads = 0;
  await route.embeddingSpendMode([], "team-a");
  const cached = routeReads;
  t.mock.timers.tick(59_000);
  await route.embeddingSpendMode([], "team-a");
  assert.equal(routeReads, cached);
  t.mock.timers.tick(1_000);
  await route.embeddingSpendMode([], "team-a");
  assert.ok(routeReads > cached);
  t.mock.timers.reset();
});

test("a failed team lookup is not remembered and the flag off repeats it", async () => {
  lookupsOn = true;
  route.resetEmbeddingSpendModeCacheForTests();
  projectThrows = true; projectReads = 0;
  await assert.rejects(route.embeddingSpendMode([15]), /project lookup failed/);
  projectThrows = false;
  assert.equal((await route.embeddingSpendMode([15])).mode, "keyword");
  assert.equal(projectReads, 2);
  lookupsOn = false;
  route.resetEmbeddingSpendModeCacheForTests();
  projectReads = 0;
  await route.embeddingSpendMode([15]);
  await route.embeddingSpendMode([15]);
  assert.equal(projectReads, 2);
});

test("board memory off does not list memory files", async () => {
  const config = "application/x-hypertask-board-memory-config";
  const facts = "application/x-hypertask-board-memory";
  lookupsOn = true; memoryOn = false; listedTypes = [];
  const off = await memory.getBoardMemoryState(6, 15);
  assert.equal(off.enabled, false);
  assert.equal(off.memories.length, 0);
  assert.deepEqual(listedTypes, [config]);
  memoryOn = true; listedTypes = [];
  const on = await memory.getBoardMemoryState(6, 15);
  assert.equal(on.enabled, true);
  assert.deepEqual(listedTypes, [config, facts]);
  lookupsOn = false; memoryOn = false; listedTypes = [];
  await memory.getBoardMemoryState(6, 15);
  assert.deepEqual(listedTypes, [config, facts]);
});

test("task writer reuses one ticket search for context and candidates", async () => {
  lookupsOn = true; searches = 0;
  const body = writer.taskWriterRequestSchema.parse({ projectId: 15, PROMPT: "find the cloth", aiMode: "AiTaskWriter" });
  const prepared = await writer.prepareTaskWriterRun(body, 6);
  assert.equal(searches, 1);
  assert.equal(prepared.messages[0].content, "candidates:9");
  lookupsOn = false; searches = 0;
  await writer.prepareTaskWriterRun(body, 6);
  assert.equal(searches, 2);
  searches = 0;
  const writing = writer.taskWriterRequestSchema.parse({ projectId: 15, PROMPT: "find the cloth", aiMode: "WriteWithAI" });
  await writer.prepareTaskWriterRun(writing, 6);
  assert.equal(searches, 1);
  console.log("HTPR-9015 lookup proof ok");
});
