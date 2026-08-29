const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "src/lib/aiModelPreferences.ts"),
  "utf8",
);
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const preferenceModule = { exports: {} };
new Function("module", "exports", javascript)(
  preferenceModule,
  preferenceModule.exports,
);

const {
  getAiModelPreferenceIds,
  mergeAiModelPreferenceUpdates,
} = preferenceModule.exports;

test("resolves a team-scoped preference before the legacy global preference", () => {
  const preferences = {
    aiChat: "global-model",
    teams: {
      "team-1": { aiChat: "team-model" },
    },
  };

  assert.deepEqual(
    getAiModelPreferenceIds(preferences, "aiChat", "team-1"),
    { teamScoped: "team-model", global: "global-model" },
  );
});

test("keeps existing global preferences as fallback for teams without an override", () => {
  const preferences = {
    taskWriter: "legacy-model",
    teams: {
      "team-1": { aiChat: "team-model" },
    },
  };

  assert.deepEqual(
    getAiModelPreferenceIds(preferences, "taskWriter", "team-2"),
    { teamScoped: undefined, global: "legacy-model" },
  );
});

test("writes one team without changing legacy defaults or other teams", () => {
  const preferences = {
    aiChat: "legacy-model",
    teams: {
      "team-1": { aiChat: "team-one-model" },
    },
  };

  assert.deepEqual(
    mergeAiModelPreferenceUpdates(
      preferences,
      { taskWriter: "team-two-model" },
      "team-2",
    ),
    {
      aiChat: "legacy-model",
      teams: {
        "team-1": { aiChat: "team-one-model" },
        "team-2": { taskWriter: "team-two-model" },
      },
    },
  );
});

test("legacy clients can still update global defaults without removing team defaults", () => {
  const preferences = {
    aiChat: "old-global-model",
    teams: {
      "team-1": { aiChat: "team-model" },
    },
  };

  assert.deepEqual(
    mergeAiModelPreferenceUpdates(preferences, { aiChat: "new-global-model" }),
    {
      aiChat: "new-global-model",
      teams: {
        "team-1": { aiChat: "team-model" },
      },
    },
  );
});
