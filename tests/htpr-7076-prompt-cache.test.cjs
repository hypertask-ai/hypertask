// HTPR-7076: fixed AI instructions are marked for Anthropic's prompt cache, and cached tokens are
// recorded and priced (reads 0.1x, writes 1.25x).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const load = createJiti(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false, interopDefault: true });
const FLAG = "htpr-7076-prompt-cache";
const cache = load(path.join(root, "src/app/api/ai/_lib/promptCache.ts"));
const { modelCostUsd } = load(path.join(root, "src/app/api/ai/_lib/sharedAllowance.ts"));
const registry = load(path.join(root, "src/lib/ai/prompts/registry.ts"));
const { isHaiku55Model, isHaiku45Model, resolveHaikuModelId } = load(path.join(root, "src/lib/aiModelOptions.ts"));

const LONG = "Fixed writer instructions. ".repeat(100); // about 675 tokens
const CACHE_OPTIONS = { anthropic: { cacheControl: { type: "ephemeral" } } };

test("flag file registers with a release risk, default Owner and QA", () => {
  const keys = load(path.join(root, "src/lib/flags/keys.ts"));
  assert.equal(keys.HTPR_7076_PROMPT_CACHE_FLAG, FLAG);
  const source = fs.readFileSync(path.join(root, "src/lib/flags/definitions/htpr-7076-prompt-cache.ts"), "utf8");
  assert.match(source, /kind: "feature"/);
  assert.match(source, /releaseRisk/);
});

test("helper returns the plain string when the flag is off, the model is not Claude, or the text is short", () => {
  assert.equal(cache.cachedInstructions({ enabled: false, modelId: "claude-sonnet-5.5", fixed: LONG }), LONG);
  assert.equal(cache.cachedInstructions({ enabled: true, modelId: "openai/gpt-6-luna", fixed: LONG }), LONG);
  assert.equal(cache.cachedInstructions({ enabled: true, modelId: "claude-sonnet-5.5", fixed: "x".repeat(2044) }), "x".repeat(2044));
  assert.equal(cache.cachedInstructions({ enabled: false, modelId: "claude-sonnet-5.5", fixed: LONG, suffix: "\n\nmore" }), `${LONG}\n\nmore`);
});

test("helper returns a cached system message followed by the uncached suffix", () => {
  const only = cache.cachedInstructions({ enabled: true, modelId: "anthropic/claude-haiku-5.5", fixed: LONG });
  assert.deepEqual(only, [{ role: "system", content: LONG, providerOptions: CACHE_OPTIONS }]);
  const withSuffix = cache.cachedInstructions({ enabled: true, modelId: "claude-sonnet-5.5", fixed: LONG, suffix: "\n\nExtra rule." });
  assert.equal(withSuffix.length, 2);
  assert.equal(withSuffix[0].content, LONG);
  assert.deepEqual(withSuffix[1], { role: "system", content: "Extra rule." });
});


test("cost: unchanged without cache tokens, 0.1x for reads and 1.25x for writes", () => {
  const pricing = { inputUsdPerToken: 0.000003, outputUsdPerToken: 0.000015 };
  const plain = modelCostUsd(pricing, 1000, 100);
  assert.equal(plain, 1000 * 0.000003 + 100 * 0.000015);
  assert.equal(modelCostUsd(pricing, 1000, 100, 0, 0), plain);
  assert.equal(modelCostUsd(pricing, 1000, 100, undefined, undefined), plain);
  const cached = modelCostUsd(pricing, 1000, 100, 600, 200);
  const expected = (200 * 1 + 600 * 0.1 + 200 * 1.25) * 0.000003 + 100 * 0.000015;
  assert.ok(Math.abs(cached - expected) < 1e-12);
  assert.ok(cached < plain);
  // Cache counts above the prompt size never go negative.
  assert.ok(modelCostUsd(pricing, 100, 0, 500, 500) >= 0);
});

function tracingHarness() {
  const rows = [], pending = [], pricingCalls = [];
  const stubs = {
    "@vercel/functions": { waitUntil: (promise) => pending.push(promise) },
    "./aiUsage": { logAiUsage: async (row) => { rows.push(row); } },
    "@/lib/ai/prompts/registry": registry,
    "@/lib/telemetry/aiChatObservability": { recordAiChatTurn: async () => {} },
    "@/lib/errors/reportError": { reportError: async () => {} },
    "@ai-sdk/anthropic": {}, "@ai-sdk/openai": {}, "@openrouter/ai-sdk-provider": {},
    ai: { ...require("ai") },
    "@/app/api/ai/_lib/sharedAllowance": {
      sharedAiAllowanceErrorMessage: () => null,
      modelCostUsd,
      gatewayCatalogModelSlug: (id) => id,
      createSharedAllowanceMiddleware: () => ({ specificationVersion: "v4" }),
      modelPricing: async (slug) => { pricingCalls.push(slug); return { inputUsdPerToken: 0.000003, outputUsdPerToken: 0.000015 }; },
    },
    "@/lib/aiModelOptions": { getAiModelDefinition: () => undefined, isHaiku55Model, isHaiku45Model, resolveHaikuModelId },
    "@/lib/flags/keys": {},
    "@/lib/aiProviders": {},
    "@/lib/aiAllowancePolicy": { FREE_TEAM_AI_ALLOWANCE_USD: 1, PAID_TEAM_AI_ALLOWANCE_USD: 5 },
    "@/lib/aiUsageClassification": { isSystemAiFeature: () => false, INCLUDED_WITH_HYPERTASK_GATEWAY_TAG: "system" },
    "@/lib/ai/customEndpoint": { isCustomEndpointConfig: () => false, normalizeCustomEndpointConfig: (value) => value },
  };
  const filename = path.join(root, "src/app/api/ai/_lib/modelProvider.ts");
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, require: (id) => stubs[id] ?? require(id), process, performance, setTimeout, clearTimeout, ReadableStream, console }, { filename });
  return { api: loaded.exports, rows, flush: () => Promise.all(pending.splice(0)) };
}

test("usage middleware records cache read and write tokens and prices them", async () => {
  const h = tracingHarness();
  const middleware = h.api.createUsageTracingMiddleware({ userId: 7, provider: "claude", feature: "task-writer" }, "claude-sonnet-5.5");
  const params = { prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] };
  const respond = (inputTokens) => ({ content: [], finishReason: { unified: "stop", raw: "end_turn" }, usage: { inputTokens, outputTokens: { total: 100 } } });
  await middleware.wrapGenerate({ params, doGenerate: async () => respond({ total: 1000, noCache: 200, cacheRead: 600, cacheWrite: 200 }) });
  await middleware.wrapGenerate({ params, doGenerate: async () => respond({ total: 1000 }) });
  await h.flush();
  assert.equal(h.rows[0].cachedInputTokens, 600);
  assert.equal(h.rows[0].cacheWriteInputTokens, 200);
  assert.equal(h.rows[0].inputTokens, 1000);
  const expected = (200 + 60 + 250) * 0.000003 + 100 * 0.000015;
  assert.ok(Math.abs(h.rows[0].costUsd - expected) < 1e-12);
  assert.equal(h.rows[1].cachedInputTokens, null);
  assert.equal(h.rows[1].cacheWriteInputTokens, null);
  assert.ok(Math.abs(h.rows[1].costUsd - (1000 * 0.000003 + 100 * 0.000015)) < 1e-12);
});

test("AiUsage schema, migration and recorder carry the two cache columns", () => {
  const schema = fs.readFileSync(path.join(root, "src/prisma/schema.prisma"), "utf8");
  assert.match(schema, /model AiUsage[\s\S]*cachedInputTokens\s+Int\?[\s\S]*cacheWriteInputTokens\s+Int\?/);
  const migration = fs.readFileSync(path.join(root, "src/prisma/migrations/20261011010000_htpr_7076_ai_usage_cache_tokens/migration.sql"), "utf8");
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "cachedInputTokens" INTEGER/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "cacheWriteInputTokens" INTEGER/);
});

function moduleWithStubs(file, stubs) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", code)(mod, mod.exports, (id) => {
    if (Object.hasOwn(stubs, id)) return stubs[id];
    if (!id.startsWith("@/") && !id.startsWith(".")) return require(id);
    throw new Error(`Unexpected dependency: ${id}`);
  });
  return mod.exports;
}

async function writerInstructions({ cacheOn, modelId = "claude-sonnet-5.5", split = false, dueDate = false, language = false, skill = "" }) {
  const dates = load(path.join(root, "src/lib/ai/taskWriterDueDate.ts"));
  const keys = load(path.join(root, "src/lib/flags/keys.ts"));
  const on = new Set([keys.HTPR_6929_COMPOSE_TASK_WRITER_FLAG]);
  if (cacheOn) on.add(FLAG);
  if (split) on.add(keys.HTPR_7056_CTRLJ_SPLIT_TASKS_FLAG);
  if (dueDate) on.add(keys.HTPR_7054_CTRLJ_DUE_DATE_FLAG);
  if (language) on.add(keys.HTPR_7057_WRITER_HEADING_LANGUAGE_FLAG);
  const flags = { isFeatureEnabled: async (flag) => on.has(flag), ...keys };
  const run = moduleWithStubs("src/app/api/ai/_lib/taskWriterRun.ts", {
    "@/lib/ai/prompts/registry": { renderPrompt: () => "output language rule" },
    "@/lib/ai/taskWriterDueDate": dates, "@/lib/flags/keys": keys,
    "@/lib/ai/composeTaskTarget": {},
    "@/lib/doneColumns": {},
    "@/lib/flags": flags,
    "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: () => ({}) },
    "@/lib/prisma": { __esModule: true, default: { project: { findFirst: async () => ({ id: 7 }) }, taskTemplate: { findMany: async () => [] } } },
    "@/app/api/ai/_lib/editorAi": {
      createTaskWriterPromptParts: () => ({ instructions: LONG, input: "note" }),
      createTaskWriterUserContent: (input) => input,
      retrieveTaskWriterContext: async () => "",
      selectTaskWriterModel: async () => ({ model: {}, modelId, settings: {}, tools: {} }),
      createDocumentAttachmentSummary: () => "", extractImgSrcs: () => null,
    },
    "@/app/api/ai/_lib/currentTaskContext": { loadCurrentTaskContext: async () => "", resolveAiUsageTaskId: async () => null },
    "@/app/api/ai/_lib/taskWriterPrompt": { formatTaskWriterRetrievedContext: () => "" },
    "@/app/api/ai/_lib/taskWriterBoardResearch": {},
    "@/app/api/ai/_lib/skills": { resolveSkills: async (text) => ({ cleanedText: text, skills: [], systemPromptAddition: skill }) },
    "@/app/api/ai/_lib/providerGate": { getProjectTeamProviderContext: async () => ({ settings: {} }) },
    "@/lib/systemModelLadder": { isAiFeatureEnabled: () => true },
    "@/app/api/ai/_lib/boardTemplateContext": { BOARD_TEMPLATE_LIMIT: 10 },
    "@/utils/controllers/turbopuffer/turbopufferHelper": {},
    "@/app/api/ai/_lib/promptCache": {
      cachedInstructionsForUser: async (userId, args) => cache.cachedInstructions({ ...args, enabled: await flags.isFeatureEnabled(FLAG, userId) }),
    },
  });
  const result = await run.prepareTaskWriterRun({ projectId: 7, PROMPT: "note", requestKind: "compose-task", aiMode: "AiTaskWriter", taskIds: [], images64: [], pdfs64: [], docx64: [], userRetrievalTexts: [], byokProviderFlags: [] }, 985);
  return result.instructions;
}

test("task writer: cached prefix is identical whether or not the flag-dependent suffixes apply", async () => {
  const variants = [{}, { split: true }, { dueDate: true }, { language: true }, { skill: "Skill body." }, { split: true, dueDate: true, language: true, skill: "Skill body." }];
  const prefixes = new Set();
  for (const variant of variants) {
    const result = await writerInstructions({ cacheOn: true, ...variant });
    assert.ok(Array.isArray(result), JSON.stringify(variant));
    assert.deepEqual(result[0].providerOptions, CACHE_OPTIONS);
    prefixes.add(result[0].content);
    if (Object.keys(variant).length) assert.ok(result.length === 2 && !result[1].providerOptions, "suffix stays uncached");
  }
  assert.deepEqual([...prefixes], [LONG]);
});

test("task writer: flag off or non-Claude model keeps the exact old string", async () => {
  assert.equal(await writerInstructions({ cacheOn: false }), LONG);
  const off = await writerInstructions({ cacheOn: false, split: true, language: true, skill: "Skill body." });
  const on = await writerInstructions({ cacheOn: true, split: true, language: true, skill: "Skill body." });
  assert.equal(typeof off, "string");
  assert.equal(off.replace(/\s+/g, " "), `${on[0].content}\n\n${on[1].content}`.replace(/\s+/g, " "));
  assert.equal(await writerInstructions({ cacheOn: true, modelId: "openai/gpt-6-luna" }), LONG);
});

test("task questions use the cached helper and task summaries stay below the minimum", () => {
  const route = fs.readFileSync(path.join(root, "src/app/api/ai/task-questions/route.ts"), "utf8");
  assert.match(route, /cachedInstructionsForUser\(viewer\.id, \{ modelId: systemModel\.model, fixed: TASK_QUESTIONS_INSTRUCTIONS \}\)/);
  assert.ok(cache.estimatePromptTokens(registry.renderPrompt("task-questions-context-1")) >= cache.PROMPT_CACHE_MIN_TOKENS);
  assert.ok(cache.estimatePromptTokens(registry.renderPrompt("task-summaries-system-2")) < cache.PROMPT_CACHE_MIN_TOKENS);
});
