const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const preferenceReads = [];
const featureFlagChecks = [];
let autoTaskDescriptionsEnabled = true;
let autoDescriptionSuggestions = true;
let preferenceFetchMode = "existing";
const afterGate = new Error("continued after auto-description preference gate");

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

stubModule("src/app/api/ai/_lib/editorAi.ts", {});
stubModule("src/app/api/ai/_lib/currentTaskContext.ts", {});
stubModule("src/app/api/ai/_lib/taskWriterPrompt.ts", {});
stubModule("src/app/api/ai/_lib/skills.ts", {});
stubModule("src/app/api/ai/_lib/providerGate.ts", {
  getProjectTeamProviderContext: async () => {
    throw afterGate;
  },
});
stubModule("src/lib/systemModelLadder.ts", {});
stubModule("src/lib/flags.ts", {
  AUTO_TASK_DESCRIPTIONS_FLAG: "htpr-6177-auto-task-descriptions",
  isFeatureEnabled: async (key, userId) => {
    featureFlagChecks.push({ key, userId });
    return autoTaskDescriptionsEnabled;
  },
});
stubModule("src/lib/prisma.ts", {
  default: {
    project: {
      findFirst: async () => ({ id: 15 }),
    },
    userSetting: {
      findUnique: async (args) => {
        if (Object.keys(args.select ?? {}).length === 1) {
          preferenceReads.push(args);
          return { autoDescriptionSuggestions };
        }
        if (preferenceFetchMode === "error") {
          throw new Error("preference read failed");
        }
        if (preferenceFetchMode === "missing") return null;
        return { autoDescriptionSuggestions };
      },
    },
  },
});
stubModule("src/lib/redis.ts", {
  getRedis: async () => ({
    get: async () => null,
    setex: async () => undefined,
  }),
});
stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
  projectContentAccessWhere: (userId) => ({ ownerId: userId }),
});
stubModule("src/app/api/ai/_lib/boardTemplateContext.ts", {
  BOARD_TEMPLATE_LIMIT: 10,
});

const jiti = createJiti(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const {
  AutoDescriptionSuggestionsDisabledError,
  prepareTaskWriterRun,
  taskWriterRequestSchema,
} = jiti(path.join(root, "src/app/api/ai/_lib/taskWriterRun.ts"));
const { fetchUserPreferenceController } = jiti(
  path.join(root, "src/utils/controllers/users/fetch_preferences.ts"),
);

function request(requestKind) {
  return taskWriterRequestSchema.parse({
    projectId: 15,
    PROMPT: "Draft a description",
    requestKind,
  });
}

test.beforeEach(() => {
  preferenceReads.length = 0;
  featureFlagChecks.length = 0;
  autoTaskDescriptionsEnabled = true;
  autoDescriptionSuggestions = true;
  preferenceFetchMode = "existing";
});

test("automatic task-writer requests stop when the user preference is disabled", async () => {
  autoDescriptionSuggestions = false;

  await assert.rejects(
    prepareTaskWriterRun(request("auto-description"), 6),
    AutoDescriptionSuggestionsDisabledError,
  );
  assert.deepEqual(preferenceReads, [
    {
      where: { userId: 6 },
      select: { autoDescriptionSuggestions: true },
    },
  ]);
});

test("manual task-writer requests do not depend on the automatic preference", async () => {
  autoDescriptionSuggestions = false;

  await assert.rejects(
    prepareTaskWriterRun(request("manual"), 6),
    (error) => error === afterGate,
  );
  assert.deepEqual(preferenceReads, []);
});

test("enabled automatic requests continue through the existing writer gates", async () => {
  await assert.rejects(
    prepareTaskWriterRun(request("auto-description"), 6),
    (error) => error === afterGate,
  );
  assert.equal(preferenceReads.length, 1);
});

test("new users receive an enabled auto-description preference fallback", async () => {
  preferenceFetchMode = "missing";

  const result = await fetchUserPreferenceController(6);

  assert.equal(result.status, 404);
  assert.equal(result.res.autoDescriptionSuggestions, true);
});

test("failed preference reads retain the auto-description fallback", async () => {
  preferenceFetchMode = "error";

  const result = await fetchUserPreferenceController(6);

  assert.equal(result.status, 500);
  assert.equal(result.res.autoDescriptionSuggestions, true);
});

// HTPR-6177: automatic drafting shipped before it was ready, so it is owner-only
// until the flag opens up. The manual writer predates it and must stay untouched.
test("automatic task-writer requests stop when the feature flag is off", async () => {
  autoTaskDescriptionsEnabled = false;

  await assert.rejects(
    prepareTaskWriterRun(request("auto-description"), 42),
    AutoDescriptionSuggestionsDisabledError,
  );
  assert.deepEqual(featureFlagChecks, [
    { key: "htpr-6177-auto-task-descriptions", userId: 42 },
  ]);
  // The flag is checked before the preference, so a blocked user is never read.
  assert.deepEqual(preferenceReads, []);
});

test("manual task-writer requests ignore the auto-description feature flag", async () => {
  autoTaskDescriptionsEnabled = false;

  await assert.rejects(
    prepareTaskWriterRun(request("manual"), 42),
    (error) => error === afterGate,
  );
  assert.deepEqual(featureFlagChecks, []);
});
