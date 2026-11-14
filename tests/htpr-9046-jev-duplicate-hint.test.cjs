const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const flag = "htpr-9046-jev-duplicate-hint";
const keys = { HTPR_9046_JEV_DUPLICATE_HINT_FLAG: flag };
const check = loadModule("src/lib/ai/jevDuplicateCheck.ts");
const candidate = {
  ticketNumber: "HTPR-123",
  url: "https://app.hypertask.ai/detail/project-15/123",
  title: "Draft loses the first line",
  description: "<p>The draft drops the first line of the brief.</p>",
};
const draft = {
  title: "Draft loses the first paragraph",
  description: "<p>When I paste a long brief, the first paragraph never appears in the draft.</p>",
};
const args = { draft, candidates: [candidate], projectId: 15, userId: 985, teamId: "team-1" };
const hintFor = (text) => check.formatDuplicateCheckHint(check.selectJevDuplicateMatch([
  { candidate, verdict: check.parseJevVerdict(text) },
]));

function hintRuntime({ funding = "managed", respond = () => "yes 0.95" } = {}) {
  const calls = [];
  const hint = loadModule("src/lib/ai/jevDuplicateHint.ts", {
    "@/app/api/ai/_lib/byokKeys": { getTeamGatewayFunding: async () => (funding === "none" ? undefined : { apiKey: "vck_fixture", source: funding }) },
    "@/app/api/ai/_lib/modelProvider": { resolveGatewayModel: () => ({ provider: "gateway" }), gatewayProviderOptionsForModel: () => undefined },
    ai: { generateText: ({ prompt }) => (calls.push(["model", prompt]), Promise.resolve(respond(prompt)).then((text) => ({ text }))) },
  });
  return { calls, hint };
}

test("verdicts parse yes, no, bare scores and percentages", () => {
  assert.deepEqual(check.parseJevVerdict("yes 0.94"), { same: true, confidence: 0.94 });
  assert.deepEqual(check.parseJevVerdict("No, 0.98"), { same: false, confidence: 0.98 });
  assert.deepEqual(check.parseJevVerdict("0.91"), { same: true, confidence: 0.91 });
  assert.deepEqual(check.parseJevVerdict("YES 93%"), { same: true, confidence: 0.93 });
  assert.deepEqual(check.parseJevVerdict("different work, 0.97"), { same: false, confidence: 0.97 });
  assert.equal(check.parseJevVerdict(""), null);
  assert.deepEqual(check.parseJevVerdict("same work"), { same: true, confidence: null });
});

test("only a same-work verdict at 0.9 or higher becomes a hint, and the best match wins", () => {
  assert.equal(hintFor("yes 0.89"), "");
  assert.equal(hintFor("no 0.99"), "");
  assert.equal(hintFor("unclear"), "");
  assert.equal(hintFor("yes 0.9"), [
    "<DUPLICATE_CHECK>",
    "ticketNumber:HTPR-123",
    "url:https://app.hypertask.ai/detail/project-15/123",
    "title:Draft loses the first line",
    "confidence:0.90",
    "</DUPLICATE_CHECK>",
  ].join("\n"));
  const other = { ...candidate, ticketNumber: "HTPR-456", title: "Other ticket" };
  const match = check.selectJevDuplicateMatch([
    { candidate, verdict: { same: true, confidence: 0.91 } },
    { candidate: other, verdict: { same: true, confidence: 0.97 } },
    { candidate: other, verdict: { same: false, confidence: 1 } },
  ]);
  assert.deepEqual([match.ticketNumber, match.confidence], ["HTPR-456", 0.97]);
});

test("only a confident same-work yes reaches the draft, own-account teams and empty candidate lists spend nothing", async () => {
  for (const options of [{ funding: "customer" }, { funding: "none" }]) {
    const runtime = hintRuntime(options);
    assert.equal(await runtime.hint.jevDuplicateHint(args), "");
    assert.equal(runtime.calls.some(([kind]) => kind === "model"), false);
  }
  const empty = hintRuntime();
  assert.equal(await empty.hint.jevDuplicateHint({ ...args, candidates: [] }), "");
  assert.deepEqual(empty.calls, []);
  assert.match(await hintRuntime().hint.jevDuplicateHint(args), /ticketNumber:HTPR-123/);
  assert.equal(await hintRuntime({ respond: () => "no 0.99" }).hint.jevDuplicateHint(args), "");
  const started = Date.now();
  await hintRuntime({ respond: () => new Promise(() => {}) }).hint.jevDuplicateHint(args);
  assert.ok(Date.now() - started < 3200);
});

function writerRun({ enabled, candidates = [candidate] }) {
  const hintCalls = [];
  const load = require("jiti")(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") }, fsCache: false });
  const rows = candidates.map((row, index) => ({ ...row, id: `task-${index + 2}`, descriptionText: row.description,
    projectId: 15, uniqueIndex: 123 + index, status: "Normal", creatorName: "Robin", searchText: row.title,
    updatedAt: "2026-11-10T00:00:00.000Z", projectTitle: "Board" }));
  return {
    hintCalls,
    prepare: async () => {
      const { taskWriterRequestSchema, prepareTaskWriterRun } = loadModule("src/app/api/ai/_lib/taskWriterRun.ts", {
        "@/lib/flags/keys": keys,
        "@/lib/flags": { ...keys, isFeatureEnabled: async (key) => enabled && key === flag },
        "@/lib/ai/prompts/registry": load(path.join(root, "src/lib/ai/prompts/registry.ts")),
        "@/app/api/ai/_lib/promptCache": { cachedInstructionsForUser: async (_userId, { fixed, suffix }) => fixed + suffix },
        "@/lib/prisma": { __esModule: true, default: {
          project: { findFirst: async () => ({ id: 15, title: "Board", section: [], labels: [] }) },
          section: { findMany: async () => [] }, taskTemplate: { findMany: async () => [] }, customField: { findMany: async () => [] }, label: { findMany: async () => [] },
        } },
        "@/lib/systemModelLadder": { isAiFeatureEnabled: () => true },
        "@/lib/doneColumns": { doneColumnTitles: () => new Set() },
        "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: () => ({}), taskWriteAccessWhere: () => ({}) },
        "@/utils/controllers/turbopuffer/turbopufferHelper": { searchTasks: async () => rows },
        "@/lib/rag/authorizeIndexedRows": { authorizeIndexedRows: async () => ({ taskRows: rows }) },
        "@/app/api/ai/_lib/editorAi": {
          ...loadModule("src/app/api/ai/_lib/editorAiPrompts.ts"),
          selectTaskWriterModel: async () => ({ modelId: "writer-fixture" }),
          retrieveTaskWriterContext: async () => "",
          createDocumentAttachmentSummary: () => "",
          createTaskWriterUserContent: (input) => input,
          extractImgSrcs: () => new Set(),
        },
        "@/app/api/ai/_lib/taskWriterPrompt": loadModule("src/app/api/ai/_lib/taskWriterPrompt.ts"),
        "@/app/api/ai/_lib/taskWriterBoardResearch": loadModule("src/app/api/ai/_lib/taskWriterBoardResearch.ts"),
        "@/app/api/ai/_lib/providerGate": { getProjectTeamProviderContext: async () => ({ teamId: "team-1", settings: {} }) },
        "@/app/api/ai/_lib/skills": { resolveSkills: async (text) => ({ cleanedText: text, skills: [], systemPromptAddition: "" }) },
        "@/app/api/ai/_lib/currentTaskContext": { loadCurrentTaskContext: async () => "", resolveAiUsageTaskId: async () => null },
        "@/app/api/ai/_lib/boardTemplateContext": loadModule("src/app/api/ai/_lib/boardTemplateContext.ts"),
        "@/lib/ai/jevDuplicateHint": { jevDuplicateHint: async (options) => {
          hintCalls.push(options);
          return "<DUPLICATE_CHECK>\nticketNumber:HTPR-123\nurl:u\ntitle:t\nconfidence:0.95\n</DUPLICATE_CHECK>";
        } },
      });
      return prepareTaskWriterRun(taskWriterRequestSchema.parse({
        projectId: 15, PROMPT: draft.description, customInstructions: "board rules", aiMode: "AiTaskWriter",
      }), 985);
    },
  };
}

test("flag on adds the duplicate rule and the hint, flag off keeps today's prompt", async () => {
  const off = writerRun({ enabled: false });
  const offRun = await off.prepare();
  assert.doesNotMatch(offRun.messages[0].content, /DUPLICATE_CHECK/);
  assert.doesNotMatch(offRun.instructions, /DUPLICATE CHECK/);
  assert.equal(off.hintCalls.length, 0);
  const on = writerRun({ enabled: true });
  const onRun = await on.prepare();
  assert.match(onRun.messages[0].content, /DUPLICATE_CHECK/);
  assert.match(onRun.instructions, /Looks like TICKET may cover the same work/);
  assert.ok(onRun.instructions.startsWith(offRun.instructions));
  assert.deepEqual([on.hintCalls.length, on.hintCalls[0].teamId, on.hintCalls[0].candidates.length], [1, "team-1", 1]);
});

test("the flag ships to Everyone and similar tickets are capped at eight", async () => {
  const many = Array.from({ length: 12 }, (_, index) => ({ ...candidate, ticketNumber: `HTPR-${200 + index}` }));
  const run = writerRun({ enabled: true, candidates: many });
  await run.prepare();
  assert.equal(run.hintCalls[0].candidates.length, 8);
  const definition = loadModule("src/lib/flags/definitions/htpr-9046-jev-duplicate-hint.ts").default;
  assert.deepEqual([definition.key, definition.kind, definition.defaultMode, definition.releaseRisk.risk], [flag, "feature", "EVERYONE", "small"]);
});
