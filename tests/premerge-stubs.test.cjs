const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const ai = require("ai");
const { z } = require("zod");
const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false });
const { extractTaskWriterProperties } = load(path.join(root, "src/app/api/ai/_lib/taskWriterProperties.ts"));

const local = {
  NODE_ENV: "production", PREMERGE_LOCAL: "1",
  DATABASE_URL: "postgresql://browser_smoke:disposable@127.0.0.1:54321/hypertask_smoke",
  REDIS_URL: "redis://127.0.0.1:63790",
  HT_PREMERGE_AI_STUB: "1", HT_PREMERGE_QUEUE_STUB: "1",
};

function harness(env = local) {
  const logs = [], values = new Map(), pending = [];
  const runtimeEnv = { ...env };
  const redis = {
    set: async (key, value) => { values.set(key, value); return "OK"; },
    get: async (key) => values.get(key),
    del: async (key) => values.delete(key),
  };
  const neverProvider = () => { throw new Error("A real provider must not be constructed"); };
  const mocks = {
    ai,
    "@vercel/functions": { waitUntil: (promise) => pending.push(promise) },
    "./aiUsage": { logAiUsage: async () => {} },
    "@/lib/ai/prompts/registry": { identifyPrompt: () => ({ promptId: "fixture", promptVersion: "1" }) },
    "@/lib/telemetry/aiChatObservability": { recordAiChatTurn: async () => {} },
    "@/lib/errors/reportError": { reportError: async () => {} },
    "@ai-sdk/anthropic": { createAnthropic: neverProvider },
    "@ai-sdk/openai": { createOpenAI: neverProvider },
    "@openrouter/ai-sdk-provider": { createOpenRouter: neverProvider },
    "@/app/api/ai/_lib/sharedAllowance": { sharedAiAllowanceErrorMessage: () => undefined },
    "@/lib/aiModelOptions": { isHaiku45Model: () => false, isHaiku55Model: () => false },
    "@/lib/aiProviders": {}, "@/lib/aiAllowancePolicy": {},
    "@/lib/aiUsageClassification": {},
    "@/lib/ai/customEndpoint": { isCustomEndpointConfig: () => false },
    "@/lib/redis": { getRedis: async () => redis },
    "@upstash/qstash": { Client: neverProvider },
    "@upstash/qstash/nextjs": { verifySignature: neverProvider },
  };
  function module(file) {
    const filename = path.join(root, file);
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const output = { exports: {} };
    vm.runInNewContext(code, {
      module: output, exports: output.exports,
      require: (id) => mocks[id] ?? require(id),
      process: { env: runtimeEnv }, URL, ReadableStream, performance, setTimeout, clearTimeout,
      console: { info: (...args) => logs.push(args.join(" ")) },
    }, { filename });
    return output.exports;
  }
  const guard = module("src/lib/premergeStubs.ts");
  mocks["@/lib/premergeStubs"] = mocks["./premergeStubs"] = guard;
  const stub = module("src/app/api/ai/_lib/premergeModel.ts");
  mocks["./premergeModel"] = stub;
  return { guard, stub, model: module("src/app/api/ai/_lib/modelProvider.ts"), queue: module("src/lib/qstash.ts"), values, logs, pending, runtimeEnv };
}

const params = {
  prompt: [
    { role: "system", content: "Private system instructions containing a fake key: secret-fixture" },
    { role: "user", content: [{ type: "text", text: "Review onboarding, due 2026-10-16" }] },
  ],
};

test("both stubs are off by default and missing credentials still fail", async () => {
  for (const switches of [{}, { HT_PREMERGE_AI_STUB: "0", HT_PREMERGE_QUEUE_STUB: "0" }]) {
    const h = harness({ ...switches });
    assert.equal(h.guard.premergeStubEnabled("ai"), false);
    assert.equal(h.guard.premergeStubEnabled("queue"), false);
    assert.equal(h.stub.createPremergeLanguageModel("fixture"), undefined);
    assert.throws(() => h.model.resolveAiModel("openai", "fixture"), /dedicated team/);
    await assert.rejects(h.queue.scheduleJobById({ path: "/api/queues/due", jobId: "task-1", body: {} }), /Missing QStash/);
    assert.equal(h.logs.length, 0);
  }
});

test("the two switches enable their own seam independently", async () => {
  const aiOnly = harness({ ...local, HT_PREMERGE_QUEUE_STUB: "0" });
  assert.ok(aiOnly.stub.createPremergeLanguageModel("fixture"));
  await assert.rejects(aiOnly.queue.publishJob({ path: "/due", body: {} }), /Missing QStash/);
  const queueOnly = harness({ ...local, HT_PREMERGE_AI_STUB: "0" });
  assert.equal(queueOnly.stub.createPremergeLanguageModel("fixture"), undefined);
  assert.throws(() => queueOnly.model.resolveAiModel("openai", "fixture"), /dedicated team/);
  assert.match((await queueOnly.queue.publishJob({ path: "/due", body: {} })).messageId, /^premerge-/);
});

test("all shared text factory branches stream a valid draft and log only model and prompt hash", async () => {
  const h = harness();
  for (const provider of ["openai", "claude", "openrouter", "gateway", "custom"]) {
    const model = h.model.resolveAiModel(provider, "fixture-model");
    const result = ai.streamText({ model, instructions: params.prompt[0].content, messages: [{ role: "user", content: "Review onboarding, due 2026-10-16" }] });
    let text = "";
    for await (const chunk of result.textStream) text += chunk;
    const draft = extractTaskWriterProperties(text);
    assert.equal(draft.title, "Review onboarding");
    assert.match(draft.description, /<h2>Summary<\/h2>/);
    assert.match(text, /2026-10-16/);
    assert.equal(await result.finishReason, "stop");
  }
  const gateway = h.model.resolveGatewayModel("anthropic/fixture");
  const generated = await ai.generateText({ model: gateway, prompt: "Review onboarding" });
  assert.match(generated.text, /Acceptance criteria/);
  assert.ok(!generated.text.includes("2026-10-16"));
  await Promise.all(h.pending);
  assert.equal(h.logs.length, 6);
  for (const line of h.logs) {
    const record = JSON.parse(line.slice("[premerge-ai] ".length));
    assert.deepEqual(Object.keys(record).sort(), ["modelId", "systemPromptSha256"]);
    assert.match(record.systemPromptSha256, /^[0-9a-f]{64}$/);
    assert.ok(!line.includes("secret-fixture"));
  }
  assert.equal(JSON.parse(h.logs[0].slice("[premerge-ai] ".length)).systemPromptSha256,
    require("node:crypto").createHash("sha256").update(params.prompt[0].content).digest("hex"));
});

test("requested language headings and due date survive deterministic generate and stream calls", async () => {
  const h = harness();
  const model = h.model.resolveAiModel("openai", "fixture");
  for (const [language, heading] of [["French", "Résumé"], ["German", "Zusammenfassung"], ["Spanish", "Resumen"], ["Dutch", "Samenvatting"], ["Japanese", "概要"], ["Chinese", "摘要"]]) {
    const input = { ...params, prompt: [{ role: "user", content: [{ type: "text", text: `Write in ${language}, due 2026-10-16` }] }] };
    const result = await model.doGenerate(input);
    assert.match(result.content[0].text, new RegExp(`<h2>${heading}</h2>`));
    const stream = await model.doStream(input);
    const chunks = [];
    for await (const part of stream.stream) chunks.push(part);
    assert.equal(chunks.find((part) => part.type === "text-delta").delta, result.content[0].text);
    assert.equal(chunks.at(-1).finishReason.unified, "stop");
  }
});

test("structured output goes through real SDK schema validation", async () => {
  const h = harness();
  const schema = z.object({ title: z.string(), approved: z.boolean(), count: z.number(), mode: z.enum(["review", "done"]), items: z.array(z.object({ note: z.string() })) });
  const result = await ai.generateObject({ model: h.model.resolveGatewayModel("fixture"), schema, prompt: "Write a fixture" });
  assert.ok(schema.safeParse(result.object).success);
  assert.equal(result.object.mode, "review");
});

test("queue records replaceable path-scoped jobs and cancellation without QStash credentials or delivery", async () => {
  const h = harness();
  const job = { path: "/api/queues/duedateQueue", jobId: "task-1", notBefore: 1792108800, body: { private: "secret-fixture" } };
  const first = await h.queue.scheduleJobById(job);
  assert.match(first.messageId, /^premerge-/);
  assert.equal(JSON.parse(h.values.get(`premerge:qstash:${job.path}:${job.jobId}`)).notBefore, job.notBefore);
  await h.queue.scheduleJobById({ ...job, notBefore: job.notBefore + 1 });
  await h.queue.scheduleJobById({ ...job, path: "/api/queues/other" });
  assert.equal(h.values.size, 2);
  assert.equal(JSON.parse(h.values.get(`premerge:qstash:${job.path}:${job.jobId}`)).notBefore, job.notBefore + 1);
  await h.queue.cancelJobById(job.jobId, job.path);
  await h.queue.cancelJobById(job.jobId, job.path);
  assert.equal(h.values.size, 1);
  const immediate = await h.queue.publishJob({ path: "/api/queues/immediate", body: {} });
  assert.match(immediate.messageId, /^premerge-/);
  assert.ok(h.logs.every((line) => !line.includes("secret-fixture")));
});

test("each switch independently refuses Vercel production, preview and any non-disposable database before use", async () => {
  for (const stub of ["AI", "QUEUE"]) {
    for (const override of [
      { VERCEL_ENV: "production" }, { VERCEL_ENV: "preview" }, { VERCEL: "1" },
      { NODE_ENV: "development", VERCEL_ENV: "preview" }, { PREMERGE_LOCAL: "0" },
      { DATABASE_URL: "postgresql://browser_smoke:disposable@db.example.invalid:5432/hypertask_smoke" },
      { DATABASE_URL: "postgresql://browser_smoke:disposable@127.0.0.1:5432/production" },
      { DATABASE_URL: "postgresql://postgres:disposable@127.0.0.1:5432/hypertask_smoke" },
      { DATABASE_URL: "postgresql://browser_smoke:disposable@127.0.0.1/hypertask_smoke" },
      { DATABASE_URL: `${local.DATABASE_URL}?host=production.invalid` },
      { DATABASE_URL: "invalid" }, { DATABASE_URL: "" },
    ]) {
      const h = harness({ ...local, HT_PREMERGE_AI_STUB: "0", HT_PREMERGE_QUEUE_STUB: "0", [`HT_PREMERGE_${stub}_STUB`]: "1", ...override });
      assert.throws(() => h.model.resolveAiModel("openai", "fixture"), /Premerge stubs require/);
      assert.throws(() => h.model.resolveGatewayModel("fixture"), /Premerge stubs require/);
      await assert.rejects(h.queue.scheduleJobById({ jobId: "1", path: "/due", body: {} }), /Premerge stubs require/);
      await assert.rejects(h.queue.cancelJobById("1", "/due"), /Premerge stubs require/);
      await assert.rejects(h.queue.publishJob({ path: "/due", body: {} }), /Premerge stubs require/);
      assert.throws(() => h.queue.getQstashClient(), /Premerge stubs require/);
      assert.equal(h.values.size, 0);
      assert.equal(h.logs.length, 0);
    }
  }
});

test("queue refuses non-local Redis before recording anything", async () => {
  for (const REDIS_URL of ["", "redis://production.invalid:6379", "redis://127.0.0.1", "redis://127.0.0.1:6379?host=production.invalid"]) {
    const h = harness({ ...local, REDIS_URL });
    await assert.rejects(h.queue.scheduleJobById({ path: "/due", jobId: "1", body: {} }), /Premerge stubs require/);
    assert.equal(h.values.size, 0);
  }
});

test("cached AI models recheck safety at inference", async () => {
  const env = { ...local };
  const h = harness(env);
  const model = h.stub.createPremergeLanguageModel("fixture");
  assert.ok(model);
  assert.match((await model.doGenerate(params)).content[0].text, /Review onboarding/);
  h.runtimeEnv.VERCEL_ENV = "production";
  await assert.rejects(model.doGenerate(params), /Premerge stubs require/);
  await assert.rejects(model.doStream(params), /Premerge stubs require/);
});

test("only the disposable launcher enables both switches", () => {
  const launcher = fs.readFileSync(path.join(root, "scripts/premerge-local.sh"), "utf8");
  assert.match(launcher, /export HT_PREMERGE_AI_STUB=1 HT_PREMERGE_QUEUE_STUB=1/);
  assert.match(launcher, /env -i/);
});
