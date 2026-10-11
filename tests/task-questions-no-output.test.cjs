const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const ai = require("ai");
const { z } = require("zod");

function harness({ content = [], finishReason = "length", failure, viewer = { id: 985 }, taskExists = true } = {}) {
  const reports = [], logs = [], calls = [];
  const task = {
    id: 7013, userId: 985, projectId: 15, title: "Fixture task", status: "Normal", section: "Todo",
    project: { teamId: "fixture-team", team: { aiProviderSettings: {} } },
    description_: { content: "Some task context" }, assignees: [], comments: [],
  };
  const model = {
    specificationVersion: "v4", provider: "fixture", modelId: "fixture", supportedUrls: {},
    doGenerate: async (params) => {
      calls.push(params);
      if (failure) throw failure;
      return { content, finishReason: { unified: finishReason }, usage: { inputTokens: { total: 10 }, outputTokens: { total: 500 } }, warnings: [] };
    },
  };
  const stubs = {
    ai,
    zod: { z },
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    "@/app/api/ai/_lib/modelProvider": {
      resolveAiModel: () => model, configureAiModelUsage: () => {},
      providerOptionsForAiModel: () => undefined, aiUsageProviderForCredential: () => "fixture",
    },
    "@/app/api/ai/_lib/byokKeys": {
      getAiDefaultModelContext: async () => ({ haiku55Enabled: true }),
      resolveAutomaticAiModel: () => model, getTeamGatewayApiKey: async () => "fixture",
    },
    "@/lib/errors/reportError": { reportError: async (report) => reports.push(report) },
    "@/lib/ai/prompts/registry": { renderPrompt: () => "Fixture prompt" },
    "@/app/api/ai/_lib/editorAi": { getCurrentUserFromCookies: async () => viewer },
    "@/app/api/ai/_lib/taskContent": { convertHtmlToText: (value) => value, isSessionNoise: () => false },
    "@/app/api/ai/_lib/systemModelLadder": { resolveSystemModel: () => ({ provider: "anthropic", model: "anthropic/claude-haiku-5.5" }) },
    "@/lib/prisma": {
      task: { findFirst: async () => taskExists ? task : null },
      comment: { findMany: async () => [] },
    },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
    "@/app/api/ai/_lib/promptCache": { cachedInstructionsForUser: async (_userId, args) => args.fixed },
  };
  const filename = path.resolve(__dirname, "../src/app/api/ai/task-questions/route.ts");
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(code, {
    module: loaded, exports: loaded.exports, require: (id) => {
      assert.ok(id in stubs, `Unexpected route dependency: ${id}`);
      return stubs[id];
    }, Error, console: { error: (...args) => logs.push(args) },
  }, { filename });
  return { reports, logs, calls, post: (body = { taskId: 7013 }) => loaded.exports.POST({ json: async () => body }) };
}

test("reasoning-only length response uses the empty fallback without reporting NoOutputGeneratedError", async () => {
  const h = harness({ content: [{ type: "reasoning", text: "Budget used for thinking" }] });
  const response = await h.post();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { questions: [] });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].maxOutputTokens, 500);
  assert.equal(h.calls[0].responseFormat.type, "json");
  assert.deepEqual(h.reports, []);
  assert.deepEqual(h.logs, []);
});

test("missing text on normal completion also uses the empty fallback without an incident", async () => {
  for (const content of [[], [{ type: "text", text: "  " }]]) {
    const h = harness({ content, finishReason: "stop" });
    assert.deepEqual(await (await h.post()).json(), { questions: [] });
    assert.deepEqual(h.reports, []);
    assert.deepEqual(h.logs, []);
  }
});

test("empty or whitespace-only structured questions use the empty fallback without creating an incident", async () => {
  for (const questions of [[], ["", "  "]]) {
    const h = harness({ content: [{ type: "text", text: JSON.stringify({ questions }) }], finishReason: "stop" });
    assert.deepEqual(await (await h.post()).json(), { questions: [] });
    assert.deepEqual(h.reports, []);
    assert.deepEqual(h.logs, []);
  }
});

test("valid questions still trim, remove empty items and cap suggestions at five", async () => {
  const h = harness({ content: [{ type: "text", text: JSON.stringify({ questions: ["  First? ", "", "Second?", "Third?", "Fourth?", "Fifth?", "Sixth?"] }) }], finishReason: "stop" });
  assert.deepEqual(await (await h.post()).json(), { questions: ["First?", "Second?", "Third?", "Fourth?", "Fifth?"] });
  assert.deepEqual(h.reports, []);
});

test("genuine provider and malformed-output failures retain error reporting and the empty fallback", async () => {
  for (const setup of [
    { failure: new Error("Provider unavailable") },
    { content: [{ type: "text", text: "not JSON" }], finishReason: "stop" },
  ]) {
    const h = harness(setup);
    assert.deepEqual(await (await h.post()).json(), { questions: [] });
    assert.equal(h.reports.length, 1);
    assert.equal(h.reports[0].extra.stage, "empty-questions-fallback");
    assert.equal(h.logs.length, 1);
  }
});

test("authentication, input validation and task visibility checks stay ahead of inference", async () => {
  for (const [setup, body, status] of [
    [{ viewer: null }, { taskId: 7013 }, 401],
    [{}, { taskId: -1 }, 400],
    [{ taskExists: false }, { taskId: 7013 }, 404],
  ]) {
    const h = harness(setup);
    assert.equal((await h.post(body)).status, status);
    assert.deepEqual(h.calls, []);
    assert.deepEqual(h.reports, []);
  }
});
