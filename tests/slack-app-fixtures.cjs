const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const actor = {
  botToken: "test-bot-token",
  installId: "install-a",
  slackTeamId: "T1",
  slackUserId: "U1",
  teamId: "team-a",
  teamAiProviderSettings: {},
  user: { id: 42, email: "person@example.com", displayName: "Person", photoURL: null },
};

function loadTs(relativePath, mocks = {}) {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const javascript = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    const mod = { exports: {} };
    cache.set(filename, mod);
    const defaults = {
      "@/lib/flags": { HTPR_6817_SLACK_APP_FLAG: "htpr-6817-slack-app", isFeatureEnabled: async () => false },
      "@/lib/slack/feature": { isSlackAppEnabled: async () => false },
      "@/lib/prisma": { __esModule: true, default: new Proxy({}, { get: () => { throw new Error("Unexpected database access in test"); } }) },
      "@/lib/redis": { getRedis: async () => { throw new Error("Unexpected Redis access in test"); } },
    };
    new Function("module", "exports", "require", javascript)(mod, mod.exports, (request) => {
      if (Object.hasOwn(mocks, request)) return mocks[request];
      if (Object.hasOwn(defaults, request)) return defaults[request];
      if (request.startsWith("@/")) return load(path.join(root, "src", `${request.slice(2)}.ts`));
      if (request.startsWith(".")) return load(path.resolve(path.dirname(filename), `${request}.ts`));
      return require(request);
    });
    return mod.exports;
  }
  return load(path.join(root, relativePath));
}

function memoryRedis() {
  const strings = new Map();
  const hashes = new Map();
  const expiry = new Map();
  return {
    strings, hashes, expiry,
    async get(key) { return strings.get(key) ?? null; },
    async set(key, value) { strings.set(key, value); },
    async del(key) { strings.delete(key); },
    async hset(key, field, value) {
      if (!hashes.has(key)) hashes.set(key, new Map());
      hashes.get(key).set(field, value);
    },
    async hmget(key, ...fields) { return fields.map((field) => hashes.get(key)?.get(field) ?? null); },
    async expire(key, seconds) { expiry.set(key, seconds); },
  };
}

module.exports = { actor, root, loadTs, memoryRedis };
