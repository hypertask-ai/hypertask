const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");

function load(file, stubs) {
  const javascript = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(javascript, {
    module: loadedModule, exports: loadedModule.exports, require: (id) => id === "react" ? { cache: (fn) => fn } : stubs[id] ?? {},
    process: { env: {} }, console: { warn() {}, log() {} },
  }, { filename: file });
  return loadedModule.exports;
}

function defaultExport(value) { return { __esModule: true, default: value }; }
const resetModule = "@/lib/ai/htpr7038ModelReset";
const preferenceFile = "src/utils/controllers/users/fetch_preferences.ts";

test("preferences controller runs reset before a cache hit, bypasses stale cache after reset, and reads normally after failure", async () => {
  for (const result of ["reset", "done", "disabled", "failed"]) {
    const events = [];
    const previous = { aiModelPreferences: { aiChat: "luna" } };
    const current = { aiModelPreferences: { aiChat: "claude-haiku-5-5" } };
    const controller = load(preferenceFile, {
      [resetModule]: { ensureHtpr7038ModelReset: async (id) => { events.push("reset"); assert.equal(id, 7); return result; } },
      "@/lib/redis": { getRedis: async () => ({
        get: async () => { events.push("cache"); return JSON.stringify(previous); }, setex: async () => {},
      }) },
      "@/lib/prisma": defaultExport({ userSetting: { findUnique: async () => { events.push("database"); return current; } } }),
    });
    const response = await controller.fetchUserPreferenceController(7);
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(JSON.stringify(response.res.aiModelPreferences)), result === "reset" ? current.aiModelPreferences : previous.aiModelPreferences);
    assert.equal(events[0], "reset");
    assert.equal(events.filter((event) => event === "reset").length, 1);
    assert.equal(events.includes("database"), result === "reset");
  }

  // Exercise real fail-open behavior, not a reset stub that already hides errors.
  const reset = load("src/lib/ai/htpr7038ModelReset.ts", {
    "@/lib/flags": { isFeatureEnabled: async () => { throw new Error("synthetic lookup failure"); } },
    "@/lib/flags/keys": {},
  });
  const controller = load(preferenceFile, {
    [resetModule]: reset,
    "@/lib/redis": { getRedis: async () => ({ get: async () => null, setex: async () => {} }) },
    "@/lib/prisma": defaultExport({ userSetting: { findUnique: async () => ({ aiModelPreferences: { aiChat: "luna" } }) } }),
  });
  const result = await controller.fetchUserPreferenceController(7);
  assert.equal(result.status, 200);
  assert.equal(result.res.aiModelPreferences.aiChat, "luna");
});

test("chat and every editor/task-writer saved-model surface await reset before reading and selecting", async () => {
  const selected = new Error("selection reached");
  const model = { id: "fixture-model", modelKey: "fixture-model", source: "openai", model: "fixture-model" };
  for (const file of ["src/lib/ai/chatStream/turnModel.ts", "src/app/api/ai/_lib/editorAi.ts"]) {
    for (const surface of ["aiChat", "taskWriter", "writeWithAi", "improveWriting", "askAi"]) {
      const events = [];
      const preferences = { [surface]: "global-choice", teams: { team: { [surface]: "team-choice" } } };
      const stubs = {
        [resetModule]: { ensureHtpr7038ModelReset: async (id) => { assert.equal(id, 7); events.push("reset"); await Promise.resolve(); events.push("reset-done"); return "disabled"; } },
        "@/lib/prisma": defaultExport({ userSetting: { findUnique: async () => { events.push("read"); return { aiModelPreferences: preferences }; } } }),
        "@/lib/aiModelPreferences": { getAiModelPreferenceIds: (value, requested, team) => {
          assert.equal(value, preferences); assert.equal(requested, surface); assert.equal(team, "team");
          return { global: value[surface], teamScoped: value.teams.team[surface] };
        } },
        "@/lib/systemModelLadder": { isAiFeatureEnabled: () => true, resolveUserFacingModelOption: (_surface, _settings, id) => { assert.equal(id, "team-choice"); events.push("select"); throw selected; } },
        "@/lib/aiModelOptions": { preferredAiModelOption: model, defaultAiModelOption: model, getDefaultAiModelOptionForPlan: () => model },
        "@/app/api/ai/_lib/planGate": { storePlanIdForProject: async () => "Pro", lunaFreePlanEnabled: async () => false, haiku55ModelEnabled: async () => false },
        "@/app/api/ai/_lib/chatTeamContext": {
          resolveChatTeamContext: async () => ({ teamId: "team", projectId: 1, aiProviderSettings: {} }),
          buildChatProviderContext: () => ({ planGateProjectId: 1, keyLookupContext: {} }),
        },
        "@/lib/ai/tools/helpers": { loadActingAgent: async () => null },
        "@/lib/nativeAgent/modelPin": { resolveAgentModelPin: () => null },
        "@/lib/ai/chatStream/models": { resolveModelSelection: (_provider, _model, _option, _settings, _surface, id) => { assert.equal(id, "team-choice"); events.push("select"); throw selected; } },
        "@/lib/ai/chatStream/errors": { reportHandledChatError: async () => {}, errorMessage: () => "selection reached", createSseErrorResponse: () => { throw selected; } },
      };
      const api = load(file, stubs);
      await assert.rejects(file.includes("turnModel")
        ? api.loadTurnModel({ aiFeature: surface }, { id: 7 })
        : api.selectTaskWriterModel({ userId: 7, aiFeature: surface, teamContext: { teamId: "team", settings: {} } }), (error) => error === selected);
      assert.deepEqual(events, ["reset", "reset-done", "read", "select"]);
    }
  }
});

test("preferences API GET reaches the shared controller and POST resets before reading or saving a pick", async () => {
  const events = [];
  const api = load("src/app/api/users/preferences/route.ts", {
    [resetModule]: { ensureHtpr7038ModelReset: async (id) => { assert.equal(id, 7); events.push("reset"); return "disabled"; } },
    "@/lib/auth/currentUser": { loadCurrentUser: async () => ({ userId: 7, user: { id: 7 } }) },
    "@/lib/flags": { isFeatureEnabled: async () => true },
    "next/server": { NextResponse: { json: (body, options) => ({ body, status: options.status }) } },
    "@/lib/mcp/readJsonBody": { readJsonBody: async () => { events.push("body"); return { ok: true, body: { aiModelPreferences: null } }; } },
    "@/utils/controllers/users/fetch_preferences": { fetchUserPreferenceController: async (id) => { assert.equal(id, 7); events.push("controller"); return { status: 200, res: {} }; } },
  });
  assert.equal((await api.GET({})).status, 200);
  assert.deepEqual(events, ["controller"]);
  events.length = 0;
  const result = await api.POST({});
  assert.deepEqual(events, ["reset", "body"]);
  assert.equal(result.status, 400);
});

test("server saved-choice readers are covered, and the UI fetches the shared preferences endpoint", () => {
  const readers = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.tsx?$/.test(file)) {
        const source = fs.readFileSync(file, "utf8");
        if (/aiModelPreferences:\s*true/.test(source)) readers.push(path.relative(root, file));
      }
    }
  }
  visit(path.join(root, "src"));
  assert.deepEqual(readers.sort(), [
    "src/app/api/ai/_lib/editorAi.ts", "src/app/api/users/preferences/route.ts",
    "src/lib/ai/chatStream/turnModel.ts", preferenceFile,
  ].sort());
  const ui = fs.readFileSync(path.join(root, "src/hooks/General/useGetUserPreferences.tsx"), "utf8");
  assert.match(ui, /\/users\/preferences/);
});

test.after(() => console.log("HTPR-7038 read point tests passed"));
