const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const preferenceReads = [];
let autoDescriptionSuggestions = true;
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
stubModule("src/lib/prisma.ts", {
  default: {
    project: {
      findFirst: async () => ({ id: 15 }),
    },
    userSetting: {
      findUnique: async (args) => {
        preferenceReads.push(args);
        return { autoDescriptionSuggestions };
      },
    },
  },
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

function request(requestKind) {
  return taskWriterRequestSchema.parse({
    projectId: 15,
    PROMPT: "Draft a description",
    requestKind,
  });
}

test.beforeEach(() => {
  preferenceReads.length = 0;
  autoDescriptionSuggestions = true;
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

test("preference fallbacks and the suggestion edge keep the feature contract", () => {
  const preferencesSource = fs.readFileSync(
    path.join(root, "src/utils/controllers/users/fetch_preferences.ts"),
    "utf8",
  );
  const writerSource = fs.readFileSync(
    path.join(
      root,
      "src/components/PageComponents/TaskDetail/AI Task Writer/AITaskWriterContainer.tsx",
    ),
    "utf8",
  );

  assert.match(
    preferencesSource,
    /status: 404,[\s\S]*?autoDescriptionSuggestions: true/,
  );
  assert.match(
    preferencesSource,
    /status: 500,[\s\S]*?autoDescriptionSuggestions: true/,
  );
  assert.match(writerSource, /border-l border-l-hypertasks-ai-purple/);
  assert.doesNotMatch(writerSource, /border-l-4 border-l-hypertasks-ai-purple/);
});
