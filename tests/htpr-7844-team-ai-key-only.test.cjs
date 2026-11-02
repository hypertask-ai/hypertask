const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true });
const funding = load(path.join(root, "src/lib/ai/teamAiFunding.ts"));
const catalog = load(path.join(root, "src/lib/aiModelOptions.ts"));
const providers = load(path.join(root, "src/lib/aiProviders.ts"));
const flag = load(path.join(root, "src/lib/flags/definitions/htpr-7844-team-ai-key-only.ts"));

const TEAM_KEY = "sk-ant-inne-team-key";
const PLATFORM_KEYS = {
  AI_GATEWAY_API_KEY: "vck_platform_gateway",
  DEMO_AI_GATEWAY_API_KEY: "vck_platform_demo",
  TURBOPUFFER_EMBEDDINGS_API_KEY: "sk-platform-embeddings",
  DEEPGRAM_API_KEY: "dg-platform-dictation",
};

function withPlatformKeys(run) {
  const previous = {};
  for (const [name, value] of Object.entries(PLATFORM_KEYS)) {
    previous[name] = process.env[name];
    process.env[name] = value;
  }
  try {
    return run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("key-only flag defaults to owner and QA and is marked as money risk", () => {
  assert.equal(flag.HTPR_7844_TEAM_AI_KEY_ONLY_FLAG, "htpr-7844-team-ai-key-only");
  assert.equal(flag.default.key, "htpr-7844-team-ai-key-only");
  assert.equal(flag.default.defaultMode, "OWNER_AND_QA");
  assert.equal(flag.default.kind, "feature");
  assert.equal(flag.default.releaseRisk.highRisk, "money");
});

test("key-only funding decisions use the team key or refuse", () => {
  withPlatformKeys(() => {
    const snapshot = { flagOn: true, aiKeyOnly: true, keys: { claude: TEAM_KEY } };
    for (const request of [
      { feature: "chat", provider: "anthropic" },
      { feature: "side-call", provider: "google" },
      { feature: "labels", provider: "google" },
    ]) {
      assert.deepEqual(funding.decideTeamAiFunding(snapshot, request), {
        mode: "byok", provider: "claude", apiKey: TEAM_KEY,
      });
    }
    for (const request of [
      { feature: "images", provider: "gateway" },
      { feature: "embeddings", provider: "openai" },
      { feature: "dictation", provider: "deepgram" },
      { feature: "gateway", provider: "gateway" },
    ]) {
      assert.equal(funding.decideTeamAiFunding(snapshot, request).mode, "refused");
    }
  });
});

test("a key-only team without a provider key is refused instead of falling back", () => {
  withPlatformKeys(() => {
    const openai = funding.decideTeamAiFunding(
      { flagOn: true, aiKeyOnly: true, keys: { claude: TEAM_KEY } },
      { provider: "openai", feature: "chat" },
    );
    assert.equal(openai.mode, "refused");
    assert.match(openai.message, /own saved keys/);
    assert.equal(openai.apiKey, undefined);

    const gateway = funding.decideTeamAiFunding(
      { flagOn: true, aiKeyOnly: true, keys: { claude: TEAM_KEY, gateway: process.env.AI_GATEWAY_API_KEY } },
      { provider: "gateway", feature: "gateway" },
    );
    assert.equal(gateway.mode, "refused");
    assert.throws(
      () => funding.embeddingAuthorization(
        { mode: "refused", message: funding.TEAM_KEY_ONLY_MESSAGE },
        process.env.TURBOPUFFER_EMBEDDINGS_API_KEY,
      ),
      (error) => error.name === "TeamKeyOnlyRefusal" && !error.message.includes(process.env.TURBOPUFFER_EMBEDDINGS_API_KEY),
    );
    assert.throws(
      () => funding.dictationAuthorization(
        { mode: "refused", message: funding.TEAM_KEY_ONLY_MESSAGE },
        process.env.DEEPGRAM_API_KEY,
      ),
      (error) => error instanceof funding.TeamKeyOnlyRefusal,
    );

    const off = funding.decideTeamAiFunding(
      { flagOn: false, aiKeyOnly: true, keys: { claude: TEAM_KEY } },
      { provider: "claude", feature: "chat" },
    );
    assert.equal(off.mode, "refused");
  });
});

test("a key-only team ignores other saved keys and gateway keys", () => {
  withPlatformKeys(() => {
    const snapshot = {
      flagOn: true,
      aiKeyOnly: true,
      keys: {
        claude: TEAM_KEY,
        openai: "sk-team-openai",
        gateway: "vck_customer_gateway",
      },
    };
    const openaiChat = funding.decideTeamAiFunding(snapshot, { provider: "openai", feature: "chat" });
    assert.equal(openaiChat.mode, "refused");
    const images = funding.decideTeamAiFunding(snapshot, { provider: "gateway", feature: "images" });
    assert.equal(images.mode, "refused");
    const embeddings = funding.decideTeamAiFunding(snapshot, { provider: "openai", feature: "embeddings" });
    assert.equal(embeddings.mode, "refused");
    const gateway = funding.decideTeamAiFunding(snapshot, { provider: "gateway", feature: "gateway" });
    assert.equal(gateway.mode, "refused");
    const sideCall = funding.decideTeamAiFunding(snapshot, { provider: "openai", feature: "side-call" });
    assert.equal(sideCall.mode, "byok");
    assert.equal(sideCall.apiKey, TEAM_KEY);
    assert.equal(sideCall.provider, "claude");
    const gatewaySideCall = funding.decideTeamAiFunding(snapshot, { provider: "gateway", feature: "side-call" });
    assert.equal(gatewaySideCall.apiKey, TEAM_KEY);
    const copiedGateway = funding.decideTeamAiFunding(
      { flagOn: true, aiKeyOnly: true, keys: { claude: "vck_customer_gateway" } },
      { provider: "claude", feature: "chat" },
    );
    assert.equal(copiedGateway.mode, "refused");
    assert.equal(funding.keyOnlyReplacementModelKey(sideCall, "openai", false), "claude-haiku-4.5");
    assert.equal(funding.keyOnlyReplacementModelKey(sideCall, "claude", true), null);
    assert.equal(funding.keyOnlyReplacementModelKey({ mode: "unrestricted" }, "openai", false), null);
  });
});

test("the picker lists only Anthropic models when that is the only saved key", () => {
  const saved = funding.aiProvidersForSavedByokKeys(["claude"]);
  assert.deepEqual(saved, ["anthropic"]);
  const rows = providers.AI_PROVIDERS.map((provider) => ({
    key: provider.key,
    enabled: provider.defaultEnabled || provider.key === "deepseek",
  }));
  const visible = funding.applyKeyOnlyProviderVisibility(rows, saved, true);
  assert.deepEqual(visible.filter((row) => row.enabled).map((row) => row.key), ["anthropic"]);
  const models = funding.modelOptionsForKeyOnlyTeam(
    catalog.aiModelOptions,
    saved,
    (modelKey) => catalog.getAiModelDefinition(modelKey),
  );
  assert.ok(models.length > 0);
  for (const option of models) {
    assert.equal(catalog.getAiModelDefinition(option.modelKey).provider, "anthropic");
  }
  assert.equal(models.some((option) => option.modelKey === "gpt-6-luna"), false);
  assert.equal(models.some((option) => catalog.getAiModelDefinition(option.modelKey).provider === "anthropic"), true);
  const mixed = funding.modelOptionsForKeyOnlyTeam(
    catalog.aiModelOptions,
    ["anthropic", "openai"],
    (modelKey) => catalog.getAiModelDefinition(modelKey),
  );
  assert.ok(mixed.length > 0);
  for (const option of mixed) {
    assert.equal(catalog.getAiModelDefinition(option.modelKey).provider, "anthropic");
  }
  const mixedRows = funding.applyKeyOnlyProviderVisibility(rows, ["anthropic", "openai"], true);
  assert.deepEqual(mixedRows.filter((row) => row.enabled).map((row) => row.key), ["anthropic"]);
});


test("disabled Anthropic refuses owned funding, while unrestricted teams stay unchanged", () => {
  const snapshot = { flagOn: true, aiKeyOnly: true, keys: { claude: TEAM_KEY }, anthropicEnabled: false };
  for (const feature of ["chat", "side-call", "labels"]) {
    assert.equal(funding.decideTeamAiFunding(snapshot, { provider: "claude", feature }).mode, "refused");
  }
  assert.equal(funding.decideTeamAiFunding({ ...snapshot, anthropicEnabled: true }, { provider: "claude", feature: "chat" }).mode, "byok");
  assert.equal(funding.decideTeamAiFunding({ ...snapshot, aiKeyOnly: false }, { provider: "claude", feature: "chat" }).mode, "unrestricted");
});

test("platform services require explicit opt-in and an enabled flag", () => {
  const base = { flagOn: true, aiKeyOnly: true, keys: { claude: TEAM_KEY } };
  for (const request of [{ feature: "embeddings", provider: "openai" }, { feature: "dictation", provider: "deepgram" }]) {
    for (const value of [undefined, false, "true"]) {
      assert.equal(funding.decideTeamAiFunding({ ...base, aiKeyOnlyPlatformServices: value }, request).mode, "refused");
    }
    assert.equal(funding.decideTeamAiFunding({ ...base, aiKeyOnlyPlatformServices: true }, request).mode, "unrestricted");
    assert.equal(funding.decideTeamAiFunding({ ...base, flagOn: false, aiKeyOnlyPlatformServices: true }, request).mode, "refused");
  }
  const opted = { ...base, aiKeyOnlyPlatformServices: true };
  assert.equal(funding.decideTeamAiFunding(opted, { feature: "chat", provider: "claude" }).apiKey, TEAM_KEY);
  for (const request of [{ feature: "chat", provider: "openai" }, { feature: "images", provider: "gateway" }, { feature: "gateway", provider: "gateway" }]) {
    assert.equal(funding.decideTeamAiFunding(opted, request).mode, "refused");
  }
});

test("setter dry runs default closed and require explicit permission", () => {
  const { spawnSync } = require("node:child_process");
  const script = path.join(root, "scripts/set-team-ai-key-only.mjs");
  const team = "11111111-1111-4111-8111-111111111111";
  const run = (...args) => spawnSync(process.execPath, [script, "--team", team, ...args], { encoding: "utf8" });
  for (const args of [["--on"], ["--on", "--deny-platform-search-dictation"], ["--off"]]) {
    const result = run(...args);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /aiKeyOnlyPlatformServices=false/);
  }
  const allowed = run("--on", "--allow-platform-search-dictation");
  assert.equal(allowed.status, 0);
  assert.match(allowed.stdout, /aiKeyOnlyPlatformServices=true/);
  assert.notEqual(run("--off", "--allow-platform-search-dictation").status, 0);
  assert.notEqual(run("--on", "--allow-platform-search-dictation", "--deny-platform-search-dictation").status, 0);
});
