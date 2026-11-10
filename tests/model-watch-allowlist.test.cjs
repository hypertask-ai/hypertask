const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { identity } = require("../scripts/model-diff");
const { readAllowlist, versionAtLeast, watched, selectWatched, worthFiling } = require("../.github/scripts/model-watch-allowlist.cjs");
const { fileReport, rollupTicket } = require("../.github/scripts/ai-model-watch.cjs");

const watch = readAllowlist();
const finding = (kind, model, inputPerMillion = 1) => ({
  kind, model, provider: model.split("/")[0], modelClass: identity(model).family,
  current: [], inputPerMillion, action: "ask Valentin before shipping", reason: "not in the current catalog",
});
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const kept = (models) => selectWatched(models.map((model) => finding("new-class", model)), watch).kept.map((item) => item.model);

test("the shipped allowlist names a version floor per watched family", () => {
  assert.ok(Object.keys(watch).length >= 8, "every provider we ship is watched");
  for (const [provider, families] of Object.entries(watch)) {
    assert.ok(Object.keys(families).length, provider);
    for (const floor of Object.values(families)) assert.match(floor, /^\d+(?:\.\d+)*$/);
  }
});

test("a malformed allowlist fails loudly instead of silencing the whole watch", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "model-watch-allowlist-"));
  try {
    for (const [content, message] of [
      ["{}", /needs a watch object/],
      ['{"watch": []}', /needs a watch object/],
      ['{"watch": {"openai": {}}}', /needs at least one family version/],
      ['{"watch": {"openai": {"gpt": 6.1}}}', /needs a version such as "5.5"/],
      ['{"watch": {"openai": {"gpt": "newest"}}}', /needs a version such as "5.5"/],
    ]) {
      const file = path.join(directory, "allowlist.json");
      fs.writeFileSync(file, content);
      assert.throws(() => readAllowlist(file), message);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("versions compare numerically so 4.20 is newer than 4.7 and 6 is older than 6.1", () => {
  assert.equal(versionAtLeast([4, 20], "4.7"), true);
  assert.equal(versionAtLeast([4, 7], "4.7"), true);
  assert.equal(versionAtLeast([6], "6.1"), false);
  assert.equal(versionAtLeast([6, 1], "6"), true);
  assert.equal(versionAtLeast([3, 1], "3"), true);
  assert.equal(versionAtLeast([2, 5], "3"), false);
});

test("only a watched family at or above its floor is filed", () => {
  assert.deepEqual(kept([
    "alibaba/qwen3.8-plus",
    "anthropic/claude-fable-5.1",
    "google/gemini-3.1-pro-preview",
    "spacexai/grok-4.20-reasoning",
    "openai/gpt-7",
  ]), [
    "alibaba/qwen3.8-plus",
    "anthropic/claude-fable-5.1",
    "google/gemini-3.1-pro-preview",
    "spacexai/grok-4.20-reasoning",
    "openai/gpt-7",
  ]);
  assert.deepEqual(kept([
    "alibaba/qwen3.8-max",
    "alibaba/qwen3-coder",
    "openai/gpt-4o",
    "openai/gpt-5.5",
    "openai/gpt-oss-120b",
    "google/gemini-nano-banana-2.1",
    "google/gemma-4.31b-it",
    "deepseek/deepseek-r1",
    "moonshotai/kimi-k2.7-code",
    "zai/glm-5-turbo",
    "nvidia/nemotron-3-ultra-550b-a55b",
    "meta/muse-spark-1.3",
  ]), []);
});

test("the families reported on HTPR-8876 file nothing, which is the whole point of the ticket", () => {
  const models = [
    "alibaba/qwen-3.235b", "amazon/nova-pro", "bytedance/seed-1.8", "cohere/command-a",
    "deepseek/deepseek-v3.2", "inception/mercury-3", "inclusionai/ling-3.1-flash",
    "inference-net/schematron-v2-turbo", "interfaze/interfaze-beta", "liquid/lfm2.5.24b-a2b",
    "meituan/longcat-2.5", "meta/llama-4-maverick", "minimax/minimax-m3", "mistral/codestral",
    "mixedbread/toast-1", "morph/morph-v3-large", "nvidia/nemotron-3-super-120b-a12b",
    "particle/particle-1", "perplexity/sonar", "poolside/laguna-s-2.1", "quiverai/arrow-2",
    "reflection/beam", "sakana/fugu-max", "scaledown/scaledown-extract-1",
    "stealth/glyph-cluster", "stepfun/step-5-preview", "tencent/hy4",
    "thinkingmachines/inkling", "xiaomi/mimo-v2.6-pro", "callstack/apex", "elorian/glimpse",
    "fireworks/ember-1", "tencent/hy-mt2-lite", "meta/muse-wonder-1.0",
  ];
  assert.deepEqual(kept(models), []);
  assert.equal(watched(finding("new-class", "nvidia/nemotron-nano-9b-v2"), watch), false);
});

test("version bumps and stale entries on shipped classes are never filtered", () => {
  for (const convention of ["new-version", "stale"]) {
    assert.equal(watched(finding(convention, "nvidia/nemotron-nano-9b-v2"), watch), true);
    assert.equal(watched(finding(convention, "openai/gpt-6.2-sol", 30), watch), true);
  }
});

test("a premium-only day files nothing, and a premium model rides along with a cheaper one", () => {
  assert.equal(worthFiling([finding("new-class", "anthropic/claude-fable-5.1", 10)]), false);
  assert.equal(worthFiling([finding("new-class", "anthropic/claude-fable-5.1", 10), finding("new-class", "openai/gpt-7", 2)]), true);
  assert.equal(worthFiling([finding("new-class", "openai/gpt-7", null)]), true);
  assert.equal(worthFiling([finding("new-version", "openai/gpt-6.2-sol", 30)]), true);
});

test("a report with nothing watched never calls the ticket API", async () => {
  const results = await fileReport({
    sourcesUsed: ["gateway"],
    findings: [finding("new-class", "nvidia/nemotron-nano-9b-v2"), finding("new-class", "alibaba/qwen3-coder")],
  }, { token: "fixture", fetchImpl: async () => { throw new Error("Unexpected ticket API call"); } });
  assert.deepEqual(results, []);
});

test("a watched subset files one rollup listing only the watched models", async () => {
  const findings = [
    finding("new-class", "alibaba/qwen3.8-plus"),
    finding("new-class", "meta/llama-4-scout"),
    finding("new-class", "anthropic/claude-fable-5.1", 10),
  ];
  const creates = [];
  const results = await fileReport({ sourcesUsed: ["gateway"], findings }, { token: "fixture",
    fetchImpl: async (url, options) => {
      if (options.method === "GET") return response({ success: true, tasks: [], total: 0 });
      creates.push(JSON.parse(options.body));
      return response({ success: true, task: { ticketNumber: "HTPR-fixture" } });
    } });
  assert.equal(creates.length, 1);
  assert.equal(creates[0].title, rollupTicket(findings.filter((item) => item.provider !== "meta")).title);
  assert.equal((creates[0].description.match(/<li>/g) || []).length, 2);
  assert.ok(creates[0].description.includes("alibaba/qwen3.8-plus"));
  assert.ok(!creates[0].description.includes("meta/llama-4-scout"));
  assert.deepEqual(results, [{ title: creates[0].title, action: "created", ticket: "HTPR-fixture" }]);
});

test("a report without usable sources fails instead of reporting a quiet day", async () => {
  await assert.rejects(fileReport({ sourcesUsed: [], findings: [] }, { token: "fixture" }), /No usable model discovery report/);
  await assert.rejects(fileReport({ sourcesUsed: ["gateway"] }, { token: "fixture" }), /No usable model discovery report/);
});
