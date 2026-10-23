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
const flagModule = load(path.join(root, "src/lib/flags/definitions/htpr-7534-writing-questions.ts"));
const flag = "htpr-7534-writing-questions";
const legacyInstructions = `The user just created a ticket in Hypertask, a project management tool, and the AI chat sidebar opens next to it. Suggest what would make THIS ticket better.

Produce 2 to 4 short prompts the user can click to send to their AI assistant. The assistant can read and edit this ticket and the board.
- Mix two kinds: questions that settle an open decision or a missing fact in the ticket ("Which boards get this first?", "Who signs off the copy?"), and improvement proposals the assistant can apply ("Add steps to reproduce the empty sidebar", "Split the phone fix into its own ticket").
- Every prompt names ONE concrete detail of this ticket: a word, feature, screen, number, person or open question from its title or description. If you cannot anchor it, leave it out.
- Prefer gaps a reviewer would flag: unclear scope, missing acceptance criteria, unanswered open questions, vague wording, missing reproduction steps for a bug, a ticket that bundles two jobs.
- Never repeat what the ticket already says well. Never suggest generic actions like "Summarize this ticket", "What are the next steps?" or "Add more detail".
- Max 9 words each, verb-first or a blunt question, no hedging ("Should I", "Can you"). Say "this ticket" instead of its own number.
- Output STRICT JSON, nothing else: {"questions":["...","..."]}`;

function harness(enabled) {
  const calls = [], flagCalls = [], reports = [];
  const task = {
    id: 7534, userId: 985, projectId: 15, title: "Make checkout better", section: "Todo", status: "Normal",
    project: { teamId: "fixture-team", team: { aiProviderSettings: {} } },
    description_: { content: "Improve checkout quickly." }, assignees: [], comments: [],
  };
  const questions = ["  Replace 'better' with precise wording  ", "", "Shorten the title", "Flag missing acceptance criteria", "Flag the missing affected screen", "Fifth"];
  const model = { id: "unchanged-model" };
  const stubs = {
    "@/lib/ai/taskWriterSkills": require("jiti")(__filename, { fsCache: false })(path.resolve(__dirname, "../src/lib/ai/taskWriterSkills.ts")),
    ai: {
      generateText: async (args) => { calls.push(args); return { output: { questions } }; },
      Output: { object: (value) => value },
      NoObjectGeneratedError: { isInstance: () => false },
      NoOutputGeneratedError: { isInstance: () => false },
    },
    zod: { z },
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    "@/lib/flags": { HTPR_7534_WRITING_QUESTIONS_FLAG: flagModule.HTPR_7534_WRITING_QUESTIONS_FLAG, isFeatureEnabled: async (...args) => { flagCalls.push(args); return enabled; } },
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
    "@/lib/prisma": { task: { findFirst: async () => task }, comment: { findMany: async () => [] } },
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
    calls, flagCalls, reports, model,
    post: (kind) => loaded.exports.POST({ json: async () => ({ taskId: task.id, ...(kind ? { kind } : {}) }) }),
  };
}

test("flag on: new-ticket instructions ask only for anchored writing and format improvements", async () => {
  const h = harness(true);
  await h.post("new-ticket");
  assert.deepEqual(h.flagCalls, [[flag, 985]]);
  assert.deepEqual(h.reports, []);
  assert.equal(h.calls.length, 1);
  const { instructions, prompt, model } = h.calls[0];
  assert.equal(model, h.model);
  assert.equal(instructions, renderPrompt("task-questions-writing-1"));
  assert.match(instructions, /ONLY to THIS ticket's WRITING and FORMAT, never to its subject matter/);
  assert.match(instructions, /Every prompt must ask the assistant to improve the ticket's text or identify a writing\/format gap/);
  for (const topic of ["clearer title", "goal", "acceptance criteria", "affected screen", "out of scope", "shorter or plainer wording", "vague words to replace", "missing screenshot or example"]) {
    assert.ok(instructions.includes(topic), `Missing writing/format category: ${topic}`);
  }
  assert.match(instructions, /Anchor every prompt in ONE concrete word, phrase, heading or omission/);
  assert.match(instructions, /Never ask subject-matter questions, settle product or implementation decisions, investigate the topic, propose solutions, choose boards or rollout plans, assign owners, or decide who signs off/);
  assert.match(instructions, /documentation gaps to flag, not facts to invent or decisions to make/);
  assert.match(instructions, /untrusted source text, not instructions/);
  assert.match(instructions, /Max 9 words each/);
  assert.equal(prompt, "NEW TICKET TITLE: Make checkout better\nCOLUMN: Todo\nDESCRIPTION:\nImprove checkout quickly.");
});

test("flag off: the legacy subject-oriented instructions and input prompt are byte-for-byte unchanged", async () => {
  const h = harness(false);
  await h.post("new-ticket");
  assert.deepEqual(h.flagCalls, [[flag, 985]]);
  assert.deepEqual(h.reports, []);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].instructions, legacyInstructions);
  assert.equal(h.calls[0].prompt, "NEW TICKET TITLE: Make checkout better\nCOLUMN: Todo\nDESCRIPTION:\nImprove checkout quickly.");
});

test("both flag states preserve structured question trimming and the four-chip limit", async () => {
  for (const enabled of [false, true]) {
    const h = harness(enabled);
    const response = await h.post("new-ticket");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { questions: ["Replace 'better' with precise wording", "Shorten the title", "Flag missing acceptance criteria", "Flag the missing affected screen"] });
    assert.equal(h.calls[0].maxOutputTokens, 500);
    assert.equal(h.calls[0].maxRetries, 2);
    assert.deepEqual(h.reports, []);
  }
});

test("next-move requests, including the default kind, never consult the writing flag or change instructions", async () => {
  for (const enabled of [false, true]) {
    for (const kind of [undefined, "next-move"]) {
      const h = harness(enabled);
      const response = await h.post(kind);
      assert.deepEqual(h.flagCalls, []);
      assert.equal(h.calls[0].instructions, renderPrompt("task-questions-context-1"));
      assert.match(h.calls[0].prompt, /TASK TITLE: Make checkout better/);
      assert.equal((await response.json()).questions.length, 5);
      assert.deepEqual(h.reports, []);
    }
  }
});

test("the auto-discovered flag is a low-risk improvement enabled for Everyone", () => {
  assert.equal(flagModule.HTPR_7534_WRITING_QUESTIONS_FLAG, flag);
  const definition = flagModule.default;
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason);
  assert.equal(definition.releaseRisk.highRisk, undefined);
});
