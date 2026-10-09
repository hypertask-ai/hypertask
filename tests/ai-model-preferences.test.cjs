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
  teamAiFeatureModelsQueryKey,
} = preferenceModule.exports;

const { QueryClient, QueryObserver } = require("@tanstack/react-query");

test("team default saves, rollbacks and resets notify mounted consumers with either flag state", () => {
  for (const haiku55Enabled of [false, true]) {
    for (const haikuDefaultEnabled of [false, true]) {
      const client = new QueryClient();
      const readerKey = teamAiFeatureModelsQueryKey(7, haiku55Enabled, haikuDefaultEnabled);
      const writerKey = teamAiFeatureModelsQueryKey("7", haiku55Enabled, haikuDefaultEnabled);
      assert.deepEqual(readerKey, writerKey);
      assert.notDeepEqual(readerKey, teamAiFeatureModelsQueryKey(7, haiku55Enabled, !haikuDefaultEnabled));
      const previous = { taskWriter: { model: null } };
      client.setQueryData(readerKey, previous);
      const observer = new QueryObserver(client, { queryKey: readerKey, enabled: false });
      const observed = [];
      const unsubscribe = observer.subscribe((result) => observed.push(result.data));
      for (const data of [
        { taskWriter: { model: "gpt-6-luna" } },
        { taskWriter: { model: "claude-haiku-5-5" } },
        previous,
        { taskWriter: { model: null } },
      ]) {
        client.setQueryData(writerKey, data);
        assert.deepEqual(observer.getCurrentResult().data, data);
        assert.deepEqual(observed.at(-1), data);
      }
      unsubscribe();
      client.clear();
    }
  }
});

test("settings reads and every cache write use the same shared flag-aware key as preferences", () => {
  const settings = fs.readFileSync(path.join(root, "src/components/Modals/Settings/AiFeaturesSection.tsx"), "utf8");
  const hook = fs.readFileSync(path.join(root, "src/hooks/General/useAiModelPreference.ts"), "utf8");
  assert.match(settings, /const queryKey = teamAiFeatureModelsQueryKey\(teamId, haiku55Enabled, haikuDefaultEnabled\)/);
  assert.match(hook, /queryKey: teamAiFeatureModelsQueryKey\(currentTeamId, haiku55Enabled, haikuDefaultEnabled\)/);
  const writes = [...settings.matchAll(/queryClient\.setQueryData\(([^,]+),/g)];
  assert.equal(writes.length, 4);
  assert.ok(writes.every((match) => match[1] === "queryKey"));
  assert.equal(settings.includes('"teamAiFeatureModels"'), false);
  assert.equal(hook.includes('"teamAiFeatureModels"'), false);
});

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
