const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
let searchArgs = null;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

function stubPackage(name, exports) {
  const filename = require.resolve(name, { paths: [root] });
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

stubPackage("ai", { generateText: async () => assert.fail("not expected") });
stubPackage("node-html-parser", { parse: () => assert.fail("not expected") });
stubModule("src/lib/prisma.ts", { default: {} });
stubModule("src/app/api/ai/_lib/aiUsage.ts", { logAiUsage: async () => {} });
stubModule("src/app/api/ai/_lib/byokKeys.ts", {
  getByokOrTeamGatewayApiKeyForProvider: async () => undefined,
});
stubModule("src/app/api/ai/_lib/modelProvider.ts", {
  aiUsageProviderForCredential: () => "gateway",
  gatewayProviderOptionsForModel: () => ({}),
  isAiGatewayEnabled: () => false,
  resolveAiModel: () => "model",
});
stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
  getProjectWhere: () => ({}),
});
stubModule("src/utils/controllers/turbopuffer/turbopufferHelper.ts", {
  buildCustomInstructionFileRows: () => [],
  deleteCustomInstructionFileInTurbopuffer: async () => {},
  listCustomInstructionFileRows: async () => {
    throw new Error("temporary memory status failure");
  },
  searchCustomInstructionFiles: async (args) => {
    searchArgs = args;
    return [
      {
        content: "Use sentence case.",
        fileName: "Writing guide",
        fileType: "text/plain",
        source: "https://example.com/writing.txt",
      },
    ];
  },
  upsertCustomInstructionFileRowsToTurbopuffer: async () => {},
});

const jiti = createJiti(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { retrieveCustomInstructionFileContext } = jiti(
  path.join(root, "src/app/api/ai/_lib/customInstructions.ts"),
);

test("custom instructions remain available when memory status lookup fails", async () => {
  const context = await retrieveCustomInstructionFileContext({
    projectId: 15,
    prompt: "Draft a task",
  });

  assert.equal(searchArgs.includeBoardMemory, false);
  assert.equal(searchArgs.projectId, 15);
  assert.equal(
    context,
    "Custom instruction file: Writing guide\nSource: https://example.com/writing.txt\nContent: Use sentence case.",
  );
});
