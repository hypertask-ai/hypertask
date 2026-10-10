// HTPR-7075: every background AI job runs on Claude 5.5 behind
// htpr-7075-background-claude. User picks (including non-Claude) stay honoured.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
  fsCache: false,
});
const catalog = jiti(path.join(root, "src/lib/aiModelOptions.ts"));
const ladder = jiti(path.join(root, "src/lib/systemModelLadder.ts"));
const fallback = jiti(path.join(root, "src/app/api/ai/chat/stream/modelFallback.ts"));
const keys = jiti(path.join(root, "src/lib/flags/keys.ts"));
const { FEATURE_FLAG_DEFINITIONS } = jiti(path.join(root, "src/lib/flags/definitions.ts"));
const { FEATURE_FLAG_RELEASE_RISKS } = jiti(path.join(root, "src/lib/flags/releaseRisk.ts"));

const ALL_PROVIDERS_ON = { providers: { openai: true, google: true, deepseek: true, moonshot: true, anthropic: true } };
const HAIKU_SLUG = "anthropic/claude-haiku-5.5";
const on = { haiku55Enabled: true, backgroundClaudeEnabled: true };
const SYSTEM_FEATURES = Object.keys(ladder.SYSTEM_FEATURES);

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function moduleWithStubs(file, stubs) {
  const code = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(code, {
    module: loaded, exports: loaded.exports,
    require: (id) => stubs[id] ?? (id.startsWith("@/") || id.startsWith("./") ? {} : require(id)),
    process: { env: { DEMO_AI_GATEWAY_API_KEY: "demo-key" } },
    console: { log() {}, warn() {}, error() {} },
    Error, Promise, Object, Array, Set, Map,
  }, { filename: path.join(root, file) });
  return loaded.exports;
}

test("the flag is a bugfix flag that defaults to Everyone and has a release-risk entry", () => {
  assert.equal(keys.HTPR_7075_BACKGROUND_CLAUDE_FLAG, "htpr-7075-background-claude");
  const definition = FEATURE_FLAG_DEFINITIONS.find((entry) => entry.key === keys.HTPR_7075_BACKGROUND_CLAUDE_FLAG);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.shippedOn, "2026-10-10");
  assert.equal(definition.defaultMode, undefined, "bugfix flags default to Everyone");
  assert.ok(FEATURE_FLAG_RELEASE_RISKS["htpr-7075-background-claude"]);
});

test("every system feature resolves to Haiku 5.5 on Anthropic for every team, with the flag on", () => {
  const teams = [
    undefined,
    {},
    { providers: { google: true, openai: true, deepseek: true, moonshot: true } },
    { providers: { google: false, openai: false } },
    // A stale saved override naming Haiku 4.5 or a retired slug never beats the 5.5 rule.
    { featureModels: { summaries: "anthropic/claude-haiku-4.5", questionSuggestions: "anthropic/claude-haiku-4.5" } },
  ];
  for (const feature of SYSTEM_FEATURES) {
    for (const settings of teams) {
      const resolved = ladder.resolveSystemModel(feature, settings, true, on);
      assert.deepEqual(resolved, { provider: "anthropic", model: HAIKU_SLUG }, `${feature} ${JSON.stringify(settings)}`);
    }
  }
});

test("a team that turned Anthropic off gets no result, never another provider", () => {
  for (const feature of SYSTEM_FEATURES) {
    assert.equal(ladder.resolveSystemModel(feature, { providers: { anthropic: false } }, true, on), null);
  }
});

test("an explicit non-Claude team pick for a system feature is still honoured", () => {
  const settings = { featureModels: { summaries: "deepseek/deepseek-v4.1-flash" }, providers: { deepseek: true } };
  assert.deepEqual(
    ladder.resolveSystemModel("summaries", settings, true, on),
    { provider: "deepseek", model: "deepseek/deepseek-v4.1-flash" },
  );
});

test("with the flag off the old fast ladder is unchanged", () => {
  const resolved = ladder.resolveSystemModel("summaries", {}, false, {});
  assert.equal(resolved.provider, "google");
  assert.equal(resolved.model, "google/gemini-3.5-flash-lite");
  assert.ok(ladder.SYSTEM_MODEL_LADDERS.fast.some((entry) => entry.model === "anthropic/claude-haiku-4.5"));
});

test("every default with no user choice is Haiku 5.5 when the flag is on", () => {
  for (const plan of [null, "Free", "Pro", "AI", "BYOK"]) {
    for (const hasByok of [false, true]) {
      assert.equal(
        catalog.defaultModelKeyFor({ ...on, plan, hasByok }, "gpt-6-luna"),
        "claude-haiku-5-5",
        `${plan} ${hasByok}`,
      );
      assert.equal(
        catalog.getDefaultAiModelOptionForPlan(plan, hasByok, false, true, true).modelKey,
        "claude-haiku-5-5",
      );
    }
  }
  // Flag off keeps Luna as the production default for the same inputs.
  assert.equal(catalog.defaultModelKeyFor({ plan: "Pro", hasByok: true }, "gpt-6-luna"), "gpt-6-luna");
});

test("saved picks of older Claude versions read as the 5.5 model of the same class", () => {
  const cases = [
    ["claude-haiku-4.5", "claude-haiku-5-5"],
    ["claude-haiku-4-5", "claude-haiku-5-5"],
    ["claude-sonnet-5-instant", "claude-sonnet-5-5-instant"],
    ["claude-sonnet-5-thinking", "claude-sonnet-5-5-thinking"],
    ["claude-sonnet-4-5-thinking", "claude-sonnet-5-5-thinking"],
    ["claude-sonnet-4.5", "claude-sonnet-5-5-instant"],
    ["claude-opus-5-instant", "claude-opus-5-5-instant"],
    ["claude-opus-4-8-thinking", "claude-opus-5-5-thinking"],
    ["claude-opus-4-1", "claude-opus-5-5-instant"],
  ];
  for (const [saved, expected] of cases) {
    const option = catalog.getAiModelOptionById(saved, true);
    assert.equal(option?.id, expected, saved);
    const oldClass = saved.split("-")[1];
    assert.equal(catalog.getAiModelDefinition(option.modelKey).modelClass, `claude-${oldClass}`);
  }
  // Read-time only: flag off, Haiku 4.5 is still its own option.
  assert.equal(catalog.getAiModelOptionById("claude-haiku-4.5", false)?.id, "claude-haiku-4.5");
});

test("raw older Claude model strings map to 5.5 and 5.5 ids pass through", () => {
  assert.equal(catalog.upgradeLegacyClaudeModelId("claude-sonnet-5"), "claude-sonnet-5-5");
  assert.equal(catalog.upgradeLegacyClaudeModelId("claude-opus-5"), "claude-opus-5-5");
  assert.equal(catalog.upgradeLegacyClaudeModelId("anthropic/claude-sonnet-5"), "anthropic/claude-sonnet-5.5");
  assert.equal(catalog.upgradeLegacyClaudeModelId("claude-haiku-4.5"), "claude-haiku-5.5");
  assert.equal(catalog.upgradeLegacyClaudeModelId("anthropic/claude-haiku-4.5"), "anthropic/claude-haiku-5.5");
  for (const id of ["claude-haiku-5-5", "claude-sonnet-5.5", "anthropic/claude-opus-5.5", "gpt-6-luna", "google/gemini-3.5-flash-lite"]) {
    assert.equal(catalog.upgradeLegacyClaudeModelId(id), id);
  }
});

test("a user's explicit non-Claude pick is honoured for user-pick features", () => {
  for (const id of ["gpt-6.1-sol-high", "gpt-6-luna", "gemini-3.5-flash-lite", "deepseek-v4.1-flash", "kimi-k3"]) {
    assert.equal(catalog.getAiModelOptionById(id, true)?.id, id);
    const option = ladder.resolveUserFacingModelOption("aiChat", ALL_PROVIDERS_ON, id, {
      haiku55Enabled: true,
      backgroundClaudeEnabled: true,
      haikuDefaultEnabled: true,
    });
    assert.equal(option.id, id);
  }
  // With no pick, the default is Haiku 5.5.
  const noPick = ladder.resolveUserFacingModelOption("aiChat", ALL_PROVIDERS_ON, null, {
    haiku55Enabled: true,
    backgroundClaudeEnabled: true,
    haikuDefaultEnabled: true,
  });
  assert.equal(noPick.id, "claude-haiku-5-5");
});

test("Haiku 4.5 leaves the picker once Claude 5.5 mode is on", () => {
  const visible = catalog.aiModelOptions.filter((option) => catalog.isAiModelOptionVisible(option, true));
  assert.equal(visible.some((option) => option.modelKey === "claude-haiku-4.5"), false);
  assert.equal(visible.some((option) => option.modelKey === "claude-haiku-5-5"), true);
  const claude = visible.filter((option) => option.modelKey.startsWith("claude-"));
  assert.ok(claude.every((option) => /5-5$/.test(option.modelKey)));
});

test("a failed Claude 5.5 model retries on the same model, never an older version or Luna", () => {
  for (const model of ["claude-haiku-5-5", "claude-haiku-5.5", "claude-sonnet-5-5", "claude-sonnet-5.5", "claude-opus-5-5", "claude-opus-5.5", "anthropic/claude-haiku-5.5"]) {
    for (const error of [{ status: 404 }, { statusCode: 403 }, new Error("model not available")]) {
      const retry = fallback.previousModelForFailedStream(model, error, false, false, true, true);
      assert.equal(retry?.model, model, model);
    }
    // No retry once output streamed or a tool ran, and not on other errors.
    assert.equal(fallback.previousModelForFailedStream(model, { status: 404 }, true, false, true, true), null);
    assert.equal(fallback.previousModelForFailedStream(model, { status: 404 }, false, true, true, true), null);
    assert.equal(fallback.previousModelForFailedStream(model, { status: 500 }, false, false, true, true), null);
  }
  // Flag off: the old chain is unchanged.
  assert.equal(fallback.previousModelForFailedStream("claude-sonnet-5-5", { status: 404 }, false, false)?.model, "claude-sonnet-5");
  assert.equal(fallback.previousModelForFailedStream("claude-haiku-5-5", { status: 404 }, false, false, true)?.model, "gpt-6-luna");
});

test("the demo board generator uses Haiku 5.5 with the flag on and Luna with it off", async () => {
  for (const enabled of [true, false]) {
    const seen = [];
    const api = moduleWithStubs("src/lib/demo/generateDemoBoard.ts", {
      zod: require("zod"),
      ai: {
        createGateway: () => (id) => { seen.push(id); return { id }; },
        generateObject: async (args) => {
          seen.push(args.providerOptions);
          return { object: { name: "N", views: [], columns: [{ tasks: [] }, { tasks: [] }, { tasks: [] }] } };
        },
      },
      "@/app/api/ai/_lib/planGate": { backgroundClaudeModelEnabled: async (userId) => { seen.push(["flag", userId]); return enabled; } },
    });
    await api.generateDemoBoard("test");
    assert.deepEqual(seen[0], ["flag", null], "evaluated with no user");
    assert.equal(seen[1], enabled ? HAIKU_SLUG : "openai/gpt-6-luna");
    assert.equal("openai" in seen[2], !enabled);
  }
});

test("getAiDefaultModelContext reports Claude 5.5 mode for the no-user and user paths", async () => {
  for (const enabled of [true, false]) {
    const byok = moduleWithStubs("src/app/api/ai/_lib/byokKeys.ts", {
      "@/app/api/ai/_lib/planGate": {
        backgroundClaudeModelEnabled: async () => enabled,
        haikuDefaultModelEnabled: async () => enabled,
        haiku55ModelEnabled: async () => enabled,
        storePlanIdForProject: async () => "Free",
      },
    });
    const context = await byok.getAiDefaultModelContext({ userId: 7 });
    assert.equal(context.backgroundClaudeEnabled, enabled);
    assert.equal(context.haiku55Enabled, enabled);
  }
});

// Every background entry point. Each one must take its model from the shared
// Claude 5.5 gates, so none of them can keep a hard-coded Gemini, Luna or GPT.
const ENTRY_POINTS = [
  ["task and comment summaries", "src/app/api/ai/_lib/taskSummaries.ts", /resolveSystemModel\([\s\S]*?defaultContext/],
  ["comment summaries", "src/app/api/ai/_lib/commentSummaries.ts", /resolveSystemModel\([\s\S]*?defaultContext/],
  ["question suggestions", "src/app/api/ai/task-questions/route.ts", /resolveSystemModel\([\s\S]*?defaultContext/],
  ["status updates", "src/app/api/reports/status-update/route.ts", /resolveSystemModel\([\s\S]*?defaultContext/],
  ["Slack thread summaries", "src/lib/slack/threadSummary.ts", /resolveSystemModel\([\s\S]*?defaultContext/],
  ["Slack chat intent", "src/lib/slack/chat.ts", /resolveSystemModel\([\s\S]*?defaultContext/],
  ["Slack task drafts", "src/lib/slack/taskCreate.ts", /resolveSystemModel\([\s\S]*?defaultContext/],
  ["chat titles", "src/lib/ai/chatStream/title.ts", /getAiDefaultModelContext[\s\S]*defaultModelKeyFor\(defaultContext/],
  ["custom instructions", "src/app/api/ai/_lib/customInstructions.ts", /getAiDefaultModelContext[\s\S]*defaultModelKeyFor\(defaultContext/],
  ["board memory", "src/app/api/ai/_lib/boardMemory.ts", /getAiDefaultModelContext[\s\S]*defaultModelKeyFor\(defaultContext/],
  ["label classifier", "src/lib/ai/labelClassifier.ts", /haikuDefaultModelEnabled\(tags\?\.userId\)/],
  ["demo board", "src/lib/demo/generateDemoBoard.ts", /backgroundClaudeModelEnabled\(null\)[\s\S]*DEMO_CLAUDE_MODEL/],
  ["native agent heartbeat and chat turns", "src/lib/ai/chatStream/turnModel.ts", /getAiDefaultModelContext/],
  ["task writer fallback", "src/app/api/ai/_lib/editorAi.ts", /sameModelRetry/],
  ["chat stream fallback", "src/lib/ai/chatStream/modelReply.ts", /sameModelRetry/],
  ["automatic model wrapper fallback", "src/app/api/ai/_lib/byokKeys.ts", /sameModelRetry/],
];

for (const [name, file, pattern] of ENTRY_POINTS) {
  test(`background entry point uses the Claude 5.5 gates: ${name}`, () => {
    assert.match(read(file), pattern);
  });
}

test("the Claude 5.5 flag reaches every background decision through one server gate", () => {
  const gate = read("src/app/api/ai/_lib/planGate.ts");
  assert.match(gate, /export async function backgroundClaudeModelEnabled/);
  assert.match(gate, /HTPR_7075_BACKGROUND_CLAUDE_FLAG, userId \?\? 0/);
  assert.match(gate, /return backgroundClaudeModelEnabled\?\.\(userId\) \?\? false/);
});

test("the flagged Claude 5.5 paths never name Luna, Gemini or an older Claude as a fallback", () => {
  const fallbackSource = read("src/app/api/ai/chat/stream/modelFallback.ts");
  const sameModelBranch = /sameModelRetry && isClaude55Model\(model\)\s*\? model/;
  assert.match(fallbackSource, sameModelBranch);
  const byok = read("src/app/api/ai/_lib/byokKeys.ts");
  const retryBlock = byok.slice(byok.indexOf("if (sameModelRetry)"), byok.indexOf("resolveLookupTeamId", byok.indexOf("if (sameModelRetry)")));
  assert.doesNotMatch(retryBlock, /luna|gemini|gpt-|sonnet-5"|opus-5"/i);
  assert.match(retryBlock, /return await doGenerate\(\)/);
  assert.match(retryBlock, /console\.error/);
});
