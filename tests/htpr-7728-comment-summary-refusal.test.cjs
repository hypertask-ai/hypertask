const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const flag = "htpr-7728-comment-summary-refusal";

function load(file, modules, console) {
  const filename = path.join(root, file);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  new Function("module", "exports", "require", "console", code)(loadedModule, loadedModule.exports, (id) => {
    if (!(id in modules)) throw new Error(`Unexpected import: ${id}`);
    return modules[id];
  }, console);
  return loadedModule.exports;
}

function fixture({ error, enabled = true, failAt = "generate", flagError = false } = {}) {
  const errors = [];
  const writes = [];
  const stored = { id: 44, text: "word ".repeat(240), summary: "Previous summary", activity: null,
    creatorId: 985, agentId: null, task: { id: 91, userId: 985, projectId: 7283,
      project: { teamId: "qa-team", team: { aiProviderSettings: {} } } } };
  const console = { log() {}, error: (...args) => errors.push(args) };
  const flags = {
    HTPR_7046_TLDR_OPEN_QUESTIONS_FLAG: "open-questions",
    HTPR_7728_COMMENT_SUMMARY_REFUSAL_FLAG: flag,
    isFeatureEnabled: async (key) => {
      if (key === flag && flagError) throw new Error("Flag store unavailable");
      return key === flag ? enabled : false;
    },
  };
  const summary = load("src/app/api/ai/_lib/commentSummaries.ts", {
    "@/lib/net/downloadWithoutBrotli": {},
    "@/app/api/ai/_lib/modelProvider": { resolveAiModel: () => ({}), configureAiModelUsage() {}, providerOptionsForAiModel: () => ({}) },
    "@/app/api/ai/_lib/byokKeys": { getAiDefaultModelContext: async () => ({ haiku55Enabled: false }),
      getTeamGatewayApiKey: async () => { if (error && failAt === "funding") throw error; return null; } },
    "@/lib/ai/prompts/registry": { renderPrompt: (_key, fallback) => fallback },
    ai: { generateText: async () => { if (error) throw error; return { text: "- First point\n- Second point", finishReason: "stop" }; } },
    "@/app/api/ai/_lib/taskContent": { convertHtmlToText: (text) => text.trim() },
    "@/app/api/ai/_lib/systemModelLadder": { resolveSystemModel: () => ({ model: "test-model", provider: "gateway" }) },
    "@/app/api/ai/_lib/allowanceError": load("src/app/api/ai/_lib/allowanceError.ts", {}, console),
    "@/lib/prisma": { __esModule: true, default: { comment: {
      findUnique: async () => stored,
      updateMany: async (write) => { writes.push(write); return { count: 1 }; },
    } } },
    "@/lib/flags": flags,
  }, console);
  const { default: handler } = load("src/pages/api/queues/FAST/generateCommentSummaryQueue.ts", {
    "@/lib/qstash": { withQstashSignature: (handler) => handler },
    "@/app/api/ai/_lib/commentSummaries": summary,
  }, console);
  async function run() {
    const response = { statusCode: null, body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; } };
    await handler({ body: { commentId: 44 } }, response);
    return { status: response.statusCode, body: response.body };
  }
  return { run, errors, writes, stored };
}

for (const reason of ["month", "day"]) {
  test(`queue quietly acknowledges ${reason} allowance refusals, including wrapped provider retries`, async () => {
    for (const failAt of ["funding", "generate"]) {
      const refusal = Object.assign(new Error("Included AI allowance used"), { name: "SharedAiAllowanceExceededError", reason });
      for (const error of [refusal, Object.assign(new Error("Retry failed"), { lastError: refusal })]) {
        const f = fixture({ error, failAt });
        assert.deepEqual(await f.run(), { status: 200, body: { skipped: true } });
        assert.deepEqual(f.errors, []);
        assert.deepEqual(f.writes, []);
        assert.equal(f.stored.summary, "Previous summary");
      }
    }
  });
}

test("switch Off restores logging; genuine errors always remain visible", async () => {
  for (const enabled of [false, true]) {
    const error = new Error("Database unavailable");
    const f = fixture({ error, enabled });
    assert.deepEqual(await f.run(), { status: 200, body: { skipped: true } });
    assert.deepEqual(f.errors, [["[commentSummaries] failed to generate summary:", error]]);
    assert.deepEqual(f.writes, []);
  }
  const error = Object.assign(new Error("Included AI allowance used"), { name: "SharedAiAllowanceExceededError" });
  for (const options of [{ enabled: false }, { flagError: true }]) {
    const f = fixture({ error, ...options });
    assert.deepEqual(await f.run(), { status: 200, body: { skipped: true } });
    assert.deepEqual(f.errors, [["[commentSummaries] failed to generate summary:", error]]);
  }
});

test("successful queue jobs still store and acknowledge the generated summary", async () => {
  for (const enabled of [false, true]) {
    const f = fixture({ enabled });
    assert.deepEqual(await f.run(), { status: 200, body: { ok: true } });
    assert.deepEqual(f.writes, [{ where: { id: 44, text: f.stored.text }, data: { summary: "- First point\n- Second point" } }]);
    assert.deepEqual(f.errors, []);
  }
});
