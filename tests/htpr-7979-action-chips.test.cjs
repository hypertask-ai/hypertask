const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const { z } = require("zod");

const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { fsCache: false });
const { renderPrompt } = load(path.join(root, "src/lib/ai/prompts/registry.ts"));
const chipFlagModule = load(path.join(root, "src/lib/flags/definitions/htpr-7979-action-chips.ts"));
const writingFlagModule = load(path.join(root, "src/lib/flags/definitions/htpr-7534-writing-questions.ts"));
const chipFlag = "htpr-7979-action-chips";
const writingFlag = "htpr-7534-writing-questions";

function harness({ chips, writing = false, rules }) {
  const calls = [], flagCalls = [], reports = [];
  const task = {
    id: 7979, userId: 985, projectId: 15, title: "Make checkout better", section: "Todo", status: "Normal",
    project: { teamId: "fixture-team", team: { aiProviderSettings: {} }, ai_custom_instructions: rules === undefined ? [] : [{ customInstruction: rules }] },
    description_: { content: "Improve checkout quickly." }, assignees: [], comments: [],
  };
  const questions = ["  Assign this to a runner  ", "", "Split the phone fix out", "Set priority to urgent", "Link the checkout ticket"];
  const model = { id: "unchanged-model" };
  const stubs = {
    "@/app/api/ai/_lib/allowanceRefusal": { warnIfAllowanceRefused: () => null },
    "@/lib/flags/definitions/htpr-7716-allowance-fallbacks": { HTPR_7716_ALLOWANCE_FALLBACKS_FLAG: "htpr-7716-allowance-fallbacks" },
    "@/lib/net/downloadWithoutBrotli": { downloadWithoutBrotli: undefined },
    "@/lib/ai/taskWriterSkills": load(path.join(root, "src/lib/ai/taskWriterSkills.ts")),
    ai: {
      generateText: async (args) => { calls.push(args); return { output: { questions } }; },
      Output: { object: (value) => value },
      NoObjectGeneratedError: { isInstance: () => false },
      NoOutputGeneratedError: { isInstance: () => false },
    },
    zod: { z },
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    "@/lib/flags": {
      HTPR_7534_WRITING_QUESTIONS_FLAG: writingFlagModule.HTPR_7534_WRITING_QUESTIONS_FLAG,
      HTPR_7979_ACTION_CHIPS_FLAG: chipFlagModule.HTPR_7979_ACTION_CHIPS_FLAG,
      isFeatureEnabled: async (...args) => {
        flagCalls.push(args);
        if (args[0] === chipFlag) return chips;
        if (args[0] === writingFlag) return writing;
        return false;
      },
    },
    "@/lib/ai/prompts/registry": { renderPrompt },
    "@/app/api/ai/_lib/modelProvider": {
      resolveAiModel: () => model, configureAiModelUsage: () => {},
      providerOptionsForAiModel: () => undefined, aiUsageProviderForCredential: () => "fixture",
    },
    "@/app/api/ai/_lib/byokKeys": {
      getAiDefaultModelContext: async () => ({ haiku55Enabled: true }),
      resolveAutomaticAiModel: () => model, getTeamGatewayApiKey: async () => "fixture",
    },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 985 }) },
    "@/lib/auth/agentScope": { withAgentScopeRequest: (_request, run) => run() },
    "@/lib/errors/reportError": { reportError: async (report) => reports.push(report) },
    "@/app/api/ai/_lib/editorAi": { getCurrentUserFromCookies: async () => ({ id: 985, displayName: "QA" }) },
    "@/app/api/ai/_lib/taskContent": { convertHtmlToText: (value) => value, isSessionNoise: () => false },
    "@/app/api/ai/_lib/systemModelLadder": { resolveSystemModel: () => ({ provider: "fixture", model: model.id }) },
    "@/lib/prisma": { default: { task: { findFirst: async () => task }, comment: { findMany: async () => [] } } },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
    "@/app/api/ai/_lib/promptCache": { cachedInstructionsForUser: async (_id, args) => args.fixed },
  };
  const filename = path.join(root, "src/app/api/ai/task-questions/route.ts");
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(code, {
    module: loaded, exports: loaded.exports, console,
    require: (id) => { assert.ok(id in stubs, `Unexpected route dependency: ${id}`); return stubs[id]; },
  }, { filename });
  return {
    calls, flagCalls, reports,
    post: (body) => loaded.exports.POST({ json: async () => ({ taskId: task.id, ...body }) }),
  };
}

test("flag definition defaults to owner only with the writing flag as a related flag", () => {
  assert.equal(chipFlagModule.default.key, chipFlag);
  assert.equal(chipFlagModule.default.defaultMode, "OWNER_ONLY");
  assert.ok(chipFlagModule.default.related.includes(writingFlag));
});

test("flag on: new-ticket chips use the action prompt with the original note and board rules", async () => {
  const h = harness({ chips: true, writing: true, rules: "Runners pick Bugs first." });
  await h.post({ kind: "new-ticket", originalNote: "  fix checkout, ask Sam  " });
  assert.deepEqual(h.reports, []);
  assert.equal(h.calls.length, 1);
  const { instructions, prompt } = h.calls[0];
  assert.equal(instructions, renderPrompt("task-questions-action-chips-1"));
  assert.match(instructions, /one-tap next action/);
  assert.match(instructions, /Max 9 words/);
  assert.match(instructions, /untrusted/);
  assert.equal(prompt, "NEW TICKET TITLE: Make checkout better\nCOLUMN: Todo\nDESCRIPTION:\nImprove checkout quickly.\n\nORIGINAL NOTE:\nfix checkout, ask Sam\n\nBOARD RULES:\nRunners pick Bugs first.");
  assert.equal(h.flagCalls.some(([key]) => key === writingFlag), false);
});

test("flag on: missing note and missing board rules fall back to explicit placeholders", async () => {
  const h = harness({ chips: true });
  await h.post({ kind: "new-ticket" });
  assert.match(h.calls[0].prompt, /ORIGINAL NOTE:\n\(not provided\)\n\nBOARD RULES:\n\(none\)$/);
});

test("flag on: an oversized note is clipped instead of rejected", async () => {
  const h = harness({ chips: true, rules: "r".repeat(5000) });
  const response = await h.post({ kind: "new-ticket", originalNote: "n".repeat(5000) });
  assert.equal(response.status, 200);
  const prompt = h.calls[0].prompt;
  assert.ok(prompt.includes(`ORIGINAL NOTE:\n${"n".repeat(2000)}\n\n`));
  assert.ok(prompt.endsWith(`BOARD RULES:\n${"r".repeat(2000)}`));
});

test("flag on: at most three trimmed chips come back", async () => {
  const h = harness({ chips: true });
  const response = await h.post({ kind: "new-ticket" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { questions: ["Assign this to a runner", "Split the phone fix out", "Set priority to urgent"] });
});

test("flag off: the writing flag decides and the original note is never sent to the model", async () => {
  for (const writing of [false, true]) {
    const h = harness({ chips: false, writing });
    const response = await h.post({ kind: "new-ticket", originalNote: "secret note" });
    assert.equal(response.status, 200);
    const { instructions, prompt } = h.calls[0];
    assert.equal(instructions, renderPrompt(writing ? "task-questions-writing-1" : "task-questions-new-ticket-1"));
    assert.equal(prompt, "NEW TICKET TITLE: Make checkout better\nCOLUMN: Todo\nDESCRIPTION:\nImprove checkout quickly.");
    assert.equal((await response.json()).questions.length, 4);
  }
});

test("next-move requests never consult the action chip flag", async () => {
  for (const chips of [false, true]) {
    const h = harness({ chips });
    await h.post({ originalNote: "ignored" });
    assert.equal(h.flagCalls.some(([key]) => key === chipFlag), false);
    assert.equal(h.calls[0].instructions, renderPrompt("task-questions-context-1"));
    assert.doesNotMatch(h.calls[0].prompt, /ORIGINAL NOTE/);
  }
});

test("client wiring: note is stored with the new task, sent with the chips request and reported as action-chip", () => {
  const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
  assert.match(read("src/lib/ai/chipEvents.ts"), /AI_CHIP_TYPES = \[[^\]]*"action-chip"/);
  assert.match(read("src/components/Modals/commands/HTC/ComposeTaskWriter.tsx"), /setOriginalNote\(\{ taskId: task\.id, note: text \}\)/);
  const list = read("src/components/AI_CHAT/MessageList.tsx");
  assert.match(list, /useFlag\(HTPR_7979_ACTION_CHIPS_FLAG\)/);
  assert.match(list, /originalNote/);
  assert.match(list, /actionChipsEnabled \? "action-chip" : "generated-question"/);
});
