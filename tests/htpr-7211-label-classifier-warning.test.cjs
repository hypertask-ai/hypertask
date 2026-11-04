const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/loadModule.cjs");

const task = { title: "Broken button", description: "Cannot click" };
const definitions = [{ labelId: "bug", prompt: "Broken features" }];
const tags = { teamId: "fixture-team", userId: 7 };

function classifier(generateText) {
  return loadModule("src/lib/ai/labelClassifier.ts", {
    "@/app/api/ai/_lib/allowanceError": { findSharedAiAllowanceError: () => null },
    "@/lib/flags": {},
    "@/app/api/ai/_lib/planAllowancePolicy": {},
    "@/lib/net/downloadWithoutBrotli": {},
    "@/app/api/ai/_lib/modelProvider": { configureAiModelUsage() {}, gatewayProviderOptionsForModel: () => ({}) },
    "@vercel/functions": {},
    ai: { generateText },
    "@/app/api/ai/_lib/byokKeys": { getTeamGatewayApiKey: async () => "fixture", resolveAutomaticAiModel: () => ({}) },
    "@/app/api/ai/_lib/planGate": {},
    "@/app/api/ai/_lib/sharedAllowance": {},
    "@/lib/ai/batch/batchJobs": {},
    "@/lib/ai/labelClassifierBatch": {},
    "@/app/api/ai/_lib/taskContent": {},
    "@/lib/configs/general.config": {},
    "@/lib/prisma": { default: {} },
    "@/lib/realtime/server": {},
    "@/lib/agentWebhooks/outbox": {},
    "@/utils/controllers/activities/createLabelActivity": { default: () => {} },
  }).classifyTaskAgainstLabels;
}

test("unparsable output warns without exposing the response or logging an error", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const error = t.mock.method(console, "error", () => {});
  const classify = classifier(async () => ({ text: "private invalid response" }));

  assert.equal(await classify(task, definitions, tags), null);
  assert.equal(warn.mock.callCount(), 1);
  assert.deepEqual(warn.mock.calls[0].arguments, ["[labelClassifier] Skipping result: model returned unparsable label output"]);
  assert.equal(error.mock.callCount(), 0);
});

test("valid arrays and prose retain their verdict without warnings", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const error = t.mock.method(console, "error", () => {});
  for (const [text, expected] of [
    ["[]", []],
    ['["bug", "unknown"]', ["bug"]],
    ['Matching labels: ["bug"]', ["bug"]],
  ]) {
    const classify = classifier(async () => ({ text }));
    assert.deepEqual(await classify(task, definitions, tags), expected);
  }
  assert.equal(warn.mock.callCount(), 0);
  assert.equal(error.mock.callCount(), 0);
});

test("provider errors still reject", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const error = new Error("Provider unavailable");
  const classify = classifier(async () => { throw error; });

  await assert.rejects(classify(task, definitions, tags), (actual) => actual === error);
  assert.equal(warn.mock.callCount(), 0);
});
