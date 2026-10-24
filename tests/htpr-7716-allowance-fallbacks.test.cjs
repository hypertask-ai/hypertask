const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const allowanceError = loadModule("src/app/api/ai/_lib/allowanceError.ts", {}, []);
const allowanceRefusal = loadModule("src/app/api/ai/_lib/allowanceRefusal.ts", {
  "@/app/api/ai/_lib/allowanceError": allowanceError,
}, []);
const flag = "htpr-7716-allowance-fallbacks";

function loadModule(relativePath, stubs, logs) {
  const filename = path.join(root, relativePath);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, Error,
    require: (name) => {
      assert.ok(Object.hasOwn(stubs, name), `Missing stub for ${name}`);
      return stubs[name];
    },
    console: { error: (...args) => logs.push(["error", ...args]), warn: (...args) => console.warn(...args) },
  }, { filename });
  return module.exports;
}

async function invoke(surface, { error, enabled = true } = {}) {
  const reports = [], logs = [], updates = [];
  const task = {
    id: 7716, userId: 7, projectId: 15, title: "Example task", section: "In Progress", status: "Normal",
    project: { teamId: 9, team: { aiProviderSettings: {} } },
    description_: { content: "A ticket with enough context" }, assignees: [], comments: [],
  };
  const stubs = {
    "@/lib/net/downloadWithoutBrotli": {},
    "@/lib/ai/taskWriterSkills": { taskWriterSkillsSchema: require("zod").z.array(require("zod").z.any()), MAX_SKILL_INPUT_LENGTH: 12000 },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 7 }) },
    "@/lib/auth/agentScope": { withAgentScopeRequest: (_request, run) => run() },
    "@/app/api/ai/_lib/modelProvider": { resolveAiModel: () => ({}), configureAiModelUsage() {}, providerOptionsForAiModel: () => ({}) },
    "@/app/api/ai/_lib/byokKeys": { getAiDefaultModelContext: async () => ({ haiku55Enabled: false }), getTeamGatewayApiKey: async () => undefined },
    "@/lib/errors/reportError": { reportError: async (payload) => reports.push(payload) },
    "@/app/api/ai/_lib/promptCache": { cachedInstructionsForUser: async () => "instructions" },
    "@/lib/ai/prompts/registry": { renderPrompt: () => "instructions" },
    "@/lib/flags": {
      isFeatureEnabled: async (key, userId) => {
        assert.equal(userId, 7);
        return key === flag && enabled;
      },
    },
    "@/lib/flags/definitions/htpr-7716-allowance-fallbacks": { HTPR_7716_ALLOWANCE_FALLBACKS_FLAG: flag },
    ai: {
      generateText: async () => {
        if (error) throw error;
        return { text: "A concise summary.", finishReason: "stop", output: { questions: [" What evidence is missing? "] } };
      },
      Output: { object: () => ({}) },
      NoOutputGeneratedError: { isInstance: (value) => value?.name === "AI_NoOutputGeneratedError" },
      NoObjectGeneratedError: { isInstance: (value) => value?.name === "AI_NoObjectGeneratedError" },
    },
    "next/server": { NextResponse: { json: Response.json } },
    zod: require("zod"),
    "@/app/api/ai/_lib/editorAi": { getCurrentUserFromCookies: async () => ({ id: 7 }) },
    "@/app/api/ai/_lib/taskContent": { convertHtmlToText: (text) => text, isSessionNoise: () => false },
    "@/app/api/ai/_lib/systemModelLadder": { resolveSystemModel: () => ({ model: "test-model", provider: "gateway" }) },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
    "@/app/api/ai/_lib/allowanceRefusal": allowanceRefusal,
    "@/lib/prisma": { __esModule: true, default: {
      task: { findFirst: async () => task },
      comment: {
        findMany: async () => [],
        findUnique: async () => ({ id: 7728, text: "context ".repeat(130), summary: null, activity: null, creatorId: 7, agentId: null, task }),
        updateMany: async (update) => { updates.push(update); return { count: 1 }; },
      },
    } },
  };
  if (surface === "task-questions") {
    const { POST } = loadModule("src/app/api/ai/task-questions/route.ts", stubs, logs);
    const response = await POST({ headers: new Headers(), json: async () => ({ taskId: 7716 }) });
    assert.equal(response.status, 200);
    return { result: await response.json(), reports, logs, updates };
  }
  const { generateAndStoreCommentSummary } = loadModule("src/app/api/ai/_lib/commentSummaries.ts", stubs, logs);
  return { result: await generateAndStoreCommentSummary(7728), reports, logs, updates };
}

for (const surface of ["task-questions", "commentSummaries"]) {
  test(`${surface}: allowance refusals keep the fallback without incident reports or error logs`, async (t) => {
    const warnings = [];
    t.mock.method(console, "warn", (...args) => warnings.push(args));
    for (const wrap of [(error) => error, (error) => new Error("model failed", { cause: error }), (error) => ({ lastError: error })]) {
      const error = Object.assign(new Error("Included allowance used up"), { name: "SharedAiAllowanceExceededError", periodKey: "private-period" });
      const actual = await invoke(surface, { error: wrap(error) });
      assert.deepEqual(actual.result, surface === "task-questions" ? { questions: [] } : null);
      assert.deepEqual(actual.reports, []);
      assert.deepEqual(actual.logs, []);
      assert.deepEqual(actual.updates, []);
    }
    const tag = surface === "task-questions" ? "ai/task-questions" : surface;
    assert.deepEqual(warnings, Array.from({ length: 3 }, () => [`[${tag}] refused: included AI allowance used up`]));
  });

  test(`${surface}: flag off preserves the old allowance error reporting`, async (t) => {
    const warnings = [];
    t.mock.method(console, "warn", (...args) => warnings.push(args));
    const error = Object.assign(new Error("Included allowance used up"), { name: "SharedAiAllowanceExceededError" });
    const actual = await invoke(surface, { error, enabled: false });
    assert.deepEqual(actual.result, surface === "task-questions" ? { questions: [] } : null);
    assert.equal(actual.logs.length, 1);
    assert.equal(actual.logs[0][0], "error");
    assert.equal(actual.logs[0][2], error);
    assert.equal(actual.reports.length, surface === "task-questions" ? 1 : 0);
    assert.deepEqual(warnings, []);
  });

  test(`${surface}: real failures still report and log errors`, async () => {
    const error = new Error("Provider unavailable");
    const actual = await invoke(surface, { error });
    assert.deepEqual(actual.result, surface === "task-questions" ? { questions: [] } : null);
    assert.equal(actual.logs.length, 1);
    assert.equal(actual.logs[0][2], error);
    assert.equal(actual.reports.length, surface === "task-questions" ? 1 : 0);
    if (surface === "task-questions") {
      assert.equal(actual.reports[0].message, "Provider unavailable");
      assert.equal(actual.reports[0].source, "handled");
      assert.equal(actual.reports[0].url, "/api/ai/task-questions");
    }
  });

  test(`${surface}: successful generation is still allowed`, async () => {
    const actual = await invoke(surface);
    assert.deepEqual(actual.result, surface === "task-questions" ? { questions: ["What evidence is missing?"] } : "A concise summary.");
    assert.deepEqual(actual.reports, []);
    assert.deepEqual(actual.logs, []);
    if (surface === "commentSummaries") {
      assert.equal(actual.updates.length, 1);
      assert.equal(actual.updates[0].data.summary, "A concise summary.");
    }
  });
}

test("task-questions: missing SDK output still uses the quiet empty fallback", async () => {
  const actual = await invoke("task-questions", { error: Object.assign(new Error("No output"), { name: "AI_NoOutputGeneratedError" }) });
  assert.deepEqual(actual.result, { questions: [] });
  assert.deepEqual(actual.reports, []);
  assert.deepEqual(actual.logs, []);
});
