const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const flag = "htpr-7716-allowance-fallbacks";

function captureConsole(t) {
  const warnings = [], errors = [];
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  t.mock.method(console, "error", (...args) => errors.push(args));
  return { warnings, errors };
}

async function invoke(surface, { error, enabled = true } = {}) {
  const reports = [], updates = [];
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
        if (key === flag) assert.equal(userId, 7);
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
    "next/server": { NextRequest: Request, NextResponse: { json: Response.json } },
    "@/app/api/ai/_lib/editorAi": { getCurrentUserFromCookies: async () => ({ id: 7 }) },
    "@/app/api/ai/_lib/taskContent": { convertHtmlToText: (text) => text, isSessionNoise: () => false },
    "@/app/api/ai/_lib/systemModelLadder": { resolveSystemModel: () => ({ model: "test-model", provider: "gateway" }) },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
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
    const { POST } = loadModule("src/app/api/ai/task-questions/route.ts", stubs);
    const response = await POST({ headers: new Headers(), json: async () => ({ taskId: 7716 }) });
    assert.equal(response.status, 200);
    return { result: await response.json(), reports, updates };
  }
  const { generateAndStoreCommentSummary } = loadModule("src/app/api/ai/_lib/commentSummaries.ts", stubs);
  return { result: await generateAndStoreCommentSummary(7728), reports, updates };
}

for (const surface of ["task-questions", "commentSummaries"]) {
  test(`${surface}: allowance refusals keep the fallback without incident reports or error logs`, async (t) => {
    const { warnings, errors } = captureConsole(t);
    for (const wrap of [(error) => error, (error) => new Error("model failed", { cause: error }), (error) => ({ lastError: error })]) {
      const error = Object.assign(new Error("Included allowance used up"), { name: "SharedAiAllowanceExceededError", periodKey: "private-period" });
      const actual = await invoke(surface, { error: wrap(error) });
      assert.deepEqual(actual.result, surface === "task-questions" ? { questions: [] } : null);
      assert.deepEqual(actual.reports, []);
      assert.deepEqual(actual.updates, []);
    }
    assert.deepEqual(errors, []);
    const tag = surface === "task-questions" ? "ai/task-questions" : surface;
    assert.deepEqual(warnings, Array.from({ length: 3 }, () => [`[${tag}] refused: included AI allowance used up`]));
  });

  test(`${surface}: flag off preserves the old allowance error reporting`, async (t) => {
    const { warnings, errors } = captureConsole(t);
    const error = Object.assign(new Error("Included allowance used up"), { name: "SharedAiAllowanceExceededError" });
    const actual = await invoke(surface, { error, enabled: false });
    assert.deepEqual(actual.result, surface === "task-questions" ? { questions: [] } : null);
    assert.equal(errors.length, 1);
    assert.equal(errors[0][1], error);
    assert.equal(actual.reports.length, surface === "task-questions" ? 1 : 0);
    assert.deepEqual(warnings, []);
  });

  test(`${surface}: real failures still report and log errors`, async (t) => {
    const { warnings, errors } = captureConsole(t);
    const error = new Error("Provider unavailable");
    const actual = await invoke(surface, { error });
    assert.deepEqual(actual.result, surface === "task-questions" ? { questions: [] } : null);
    assert.equal(errors.length, 1);
    assert.equal(errors[0][1], error);
    assert.equal(actual.reports.length, surface === "task-questions" ? 1 : 0);
    if (surface === "task-questions") {
      assert.equal(actual.reports[0].message, "Provider unavailable");
      assert.equal(actual.reports[0].source, "handled");
      assert.equal(actual.reports[0].url, "/api/ai/task-questions");
    }
    assert.deepEqual(warnings, []);
  });

  test(`${surface}: successful generation is still allowed`, async (t) => {
    const { warnings, errors } = captureConsole(t);
    const actual = await invoke(surface);
    assert.deepEqual(actual.result, surface === "task-questions" ? { questions: ["What evidence is missing?"] } : "A concise summary.");
    assert.deepEqual(actual.reports, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
    if (surface === "commentSummaries") {
      assert.equal(actual.updates.length, 1);
      assert.equal(actual.updates[0].data.summary, "A concise summary.");
    }
  });
}

test("task-questions: missing SDK output still uses the quiet empty fallback", async (t) => {
  const { errors } = captureConsole(t);
  const actual = await invoke("task-questions", { error: Object.assign(new Error("No output"), { name: "AI_NoOutputGeneratedError" }) });
  assert.deepEqual(actual.result, { questions: [] });
  assert.deepEqual(actual.reports, []);
  assert.deepEqual(errors, []);
});
