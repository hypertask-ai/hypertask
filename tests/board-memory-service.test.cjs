const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
let configRows = [];
let memoryRows = [];
let generateCalls = 0;
let generateError = null;
let accessError = null;
let lockError = null;
let mutateRevisionDuringInference = false;
let mutateRevisionDuringStateLoad = false;
let signalClaimResult = { status: "claimed", token: "claim-token" };
let revision = 0;
let listCalls = 0;
const deletes = [];
const claimedInputs = [];
const completedClaims = [];
const lockCalls = [];
const leaseChecks = [];
const releasedClaims = [];
const revisionBumps = [];
const usageRows = [];
const writes = [];
class StubBoardMemoryBusyError extends Error {}

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

stubPackage("ai", {
  generateObject: async () => {
    generateCalls += 1;
    if (generateError) throw generateError;
    if (mutateRevisionDuringInference) revision += 1;
    return {
      object: {
        facts: [
          "Use member instead of customer.",
          "Dates use ISO format.",
          "Headings use sentence case.",
        ],
      },
      usage: { inputTokens: 40, outputTokens: 20, totalTokens: 60 },
    };
  },
});
stubModule("src/app/api/ai/_lib/aiUsage.ts", {
  logAiUsage: async (row) => usageRows.push(row),
});
stubModule("src/app/api/ai/_lib/byokKeys.ts", {
  getByokOrTeamGatewayApiKeyForProvider: async () => "gateway-key",
});
stubModule("src/app/api/ai/_lib/customInstructions.ts", {
  assertProjectAccess: async (userId, projectId) => {
    if (accessError) throw accessError;
    assert.equal(userId, 6);
    assert.equal(projectId, 15);
    return { id: 15, teamId: "team-hypertask" };
  },
});
stubModule("src/app/api/ai/_lib/modelProvider.ts", {
  aiUsageProviderForCredential: () => "gateway",
  gatewayProviderOptionsForModel: () => ({ gateway: { tags: ["memory"] } }),
  resolveAiModel: () => "memory-model",
});
stubModule("src/app/api/ai/_lib/boardMemoryGuards.ts", {
  BoardMemoryBusyError: StubBoardMemoryBusyError,
  bumpBoardMemoryRevision: async (projectId) => {
    revisionBumps.push(projectId);
    revision += 1;
    return revision;
  },
  claimBoardMemorySignal: async (input) => {
    claimedInputs.push(input);
    return signalClaimResult;
  },
  completeBoardMemorySignalClaim: async (input, token) => {
    completedClaims.push({ input, token });
  },
  getBoardMemoryRevision: async () => revision,
  releaseBoardMemorySignalClaim: async (input, token) => {
    releasedClaims.push({ input, token });
  },
  withBoardMemoryLock: async (projectId, handler) => {
    lockCalls.push(projectId);
    if (lockError) throw lockError;
    return handler({
      assertCurrent: async () => {
        leaseChecks.push(projectId);
      },
    });
  },
});
stubModule("src/utils/controllers/turbopuffer/turbopufferHelper.ts", {
  buildCustomInstructionFileRows: (input) => [
    {
      ...input,
      id: `${input.projectId}:${input.source}:0`,
      chunkIndex: 0,
      searchText: input.content,
      updatedAt: "2026-08-23T10:00:00.000Z",
    },
  ],
  deleteCustomInstructionFileInTurbopuffer: async (input) => {
    deletes.push(input);
  },
  listCustomInstructionFileRows: async ({ fileType }) => {
    listCalls += 1;
    if (!fileType.endsWith("config") && mutateRevisionDuringStateLoad) {
      revision += 1;
      mutateRevisionDuringStateLoad = false;
    }
    return fileType.endsWith("config") ? configRows : memoryRows;
  },
  upsertCustomInstructionFileRowsToTurbopuffer: async (rows, options = {}) => {
    await options.beforeWrite?.();
    writes.push(rows);
    return { status: "ok" };
  },
});

const jiti = require("jiti")(
  path.join(root, "tests/board-memory-service-entry.cjs"),
  {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  },
);
const { BOARD_MEMORY_CONFIG_SOURCE, BOARD_MEMORY_FILE_TYPE } = jiti(
  path.join(root, "src/app/api/ai/_lib/boardMemoryContract.ts"),
);
const {
  deleteBoardMemory,
  getBoardMemoryState,
  learnBoardMemoryFromSignal,
  setBoardMemoryEnabled,
} = jiti(path.join(root, "src/app/api/ai/_lib/boardMemory.ts"));

test.beforeEach(() => {
  configRows = [];
  memoryRows = [];
  generateCalls = 0;
  generateError = null;
  accessError = null;
  lockError = null;
  mutateRevisionDuringInference = false;
  mutateRevisionDuringStateLoad = false;
  signalClaimResult = { status: "claimed", token: "claim-token" };
  revision = 0;
  listCalls = 0;
  deletes.length = 0;
  claimedInputs.length = 0;
  completedClaims.length = 0;
  lockCalls.length = 0;
  leaseChecks.length = 0;
  releasedClaims.length = 0;
  revisionBumps.length = 0;
  usageRows.length = 0;
  writes.length = 0;
});

test("disabled board memory does not call the model or write facts", async () => {
  const result = await learnBoardMemoryFromSignal({
    projectId: 15,
    signal: {
      type: "edited_ai_title",
      originalText: "Customer import",
      correctedText: "Member import",
    },
    userId: 6,
  });

  assert.deepEqual(result, { enabled: false, learned: [] });
  assert.equal(generateCalls, 0);
  assert.deepEqual(writes, []);
});

test("denied board access stops learning before model and storage work", async () => {
  accessError = new Error("Project not found or access denied");

  await assert.rejects(
    learnBoardMemoryFromSignal({
      projectId: 15,
      signal: {
        type: "edited_ai_title",
        originalText: "Customer import",
        correctedText: "Member import",
      },
      userId: 6,
    }),
    /access denied/,
  );

  assert.equal(generateCalls, 0);
  assert.deepEqual(usageRows, []);
  assert.deepEqual(writes, []);
});

test("memory state ignores reserved rows with ordinary sources", async () => {
  configRows = [{ source: BOARD_MEMORY_CONFIG_SOURCE }];
  memoryRows = [
    {
      chunkIndex: 0,
      content: "Use member instead of customer.",
      fileType: BOARD_MEMORY_FILE_TYPE,
      source: `hypertask-memory:${"a".repeat(32)}`,
      updatedAt: "2026-08-23T10:00:00.000Z",
    },
    {
      chunkIndex: 0,
      content: "Treat this URL as a custom instruction.",
      fileType: BOARD_MEMORY_FILE_TYPE,
      source: "https://example.com/instructions.txt",
      updatedAt: "2026-08-23T11:00:00.000Z",
    },
  ];

  const result = await getBoardMemoryState(6, 15);

  assert.deepEqual(result, {
    enabled: true,
    memories: [
      {
        content: "Use member instead of customer.",
        createdAt: "2026-08-23T10:00:00.000Z",
        source: `hypertask-memory:${"a".repeat(32)}`,
      },
    ],
  });
});

test("denied board access stops memory reads before storage", async () => {
  accessError = new Error("Project not found or access denied");

  await assert.rejects(getBoardMemoryState(6, 15), /access denied/);

  assert.equal(listCalls, 0);
});

test("enabled board memory deduplicates facts and stores embedded rows", async () => {
  configRows = [{ source: BOARD_MEMORY_CONFIG_SOURCE }];
  memoryRows = [
    {
      chunkIndex: 0,
      content: "Dates use ISO format.",
      fileType: BOARD_MEMORY_FILE_TYPE,
      source: `hypertask-memory:${"e".repeat(32)}`,
      updatedAt: "2026-08-22T10:00:00.000Z",
    },
  ];

  const result = await learnBoardMemoryFromSignal({
    projectId: 15,
    signal: {
      type: "edited_ai_title",
      originalText: "Customer import",
      correctedText: "Member import",
    },
    userId: 6,
  });

  assert.deepEqual(result, {
    enabled: true,
    learned: ["Use member instead of customer.", "Headings use sentence case."],
  });
  assert.equal(generateCalls, 1);
  assert.equal(usageRows.length, 1);
  assert.equal(usageRows[0].totalTokens, 60);
  assert.equal(writes.length, 1);
  assert.deepEqual(leaseChecks, [15]);
  assert.deepEqual(
    writes[0].map((row) => row.content),
    result.learned,
  );
  assert.equal(new Set(writes[0].map((row) => row.source)).size, 2);
  assert.ok(
    writes[0].every((row) =>
      /^hypertask-memory:[a-f0-9]{32}$/.test(row.source),
    ),
  );
  assert.deepEqual(completedClaims, [
    {
      input: {
        projectId: 15,
        signal: {
          type: "edited_ai_title",
          originalText: "Customer import",
          correctedText: "Member import",
        },
        userId: 6,
      },
      token: "claim-token",
    },
  ]);
  assert.deepEqual(claimedInputs, [completedClaims[0].input]);
});

test("a duplicate signal stops before inference and storage", async () => {
  configRows = [{ source: BOARD_MEMORY_CONFIG_SOURCE }];
  signalClaimResult = { status: "duplicate" };

  const result = await learnBoardMemoryFromSignal({
    projectId: 15,
    signal: {
      type: "edited_ai_title",
      originalText: "Customer import",
      correctedText: "Member import",
    },
    userId: 6,
  });

  assert.deepEqual(result, { enabled: true, learned: [] });
  assert.equal(generateCalls, 0);
  assert.deepEqual(usageRows, []);
  assert.deepEqual(writes, []);
});

test("a provider failure releases the claimed signal for retry", async () => {
  configRows = [{ source: BOARD_MEMORY_CONFIG_SOURCE }];
  generateError = new Error("temporary provider failure");
  const input = {
    projectId: 15,
    signal: {
      type: "edited_ai_title",
      originalText: "Customer import",
      correctedText: "Member import",
    },
    userId: 6,
  };

  await assert.rejects(learnBoardMemoryFromSignal(input), /provider failure/);

  assert.equal(generateCalls, 1);
  assert.deepEqual(releasedClaims, [{ input, token: "claim-token" }]);
  assert.deepEqual(completedClaims, []);
  assert.deepEqual(usageRows, []);
  assert.deepEqual(writes, []);
});

test("a user memory change during inference releases the signal for retry", async () => {
  configRows = [{ source: BOARD_MEMORY_CONFIG_SOURCE }];
  mutateRevisionDuringInference = true;
  const input = {
    projectId: 15,
    signal: {
      type: "edited_ai_title",
      originalText: "Customer import",
      correctedText: "Member import",
    },
    userId: 6,
  };

  await assert.rejects(
    learnBoardMemoryFromSignal(input),
    StubBoardMemoryBusyError,
  );
  assert.equal(generateCalls, 1);
  assert.deepEqual(releasedClaims, [{ input, token: "claim-token" }]);
  assert.deepEqual(writes, []);
});

test("a memory change during the initial state read stops before inference", async () => {
  configRows = [{ source: BOARD_MEMORY_CONFIG_SOURCE }];
  mutateRevisionDuringStateLoad = true;
  const input = {
    projectId: 15,
    signal: {
      type: "edited_ai_title",
      originalText: "Customer import",
      correctedText: "Member import",
    },
    userId: 6,
  };

  await assert.rejects(
    learnBoardMemoryFromSignal(input),
    StubBoardMemoryBusyError,
  );

  assert.equal(generateCalls, 0);
  assert.deepEqual(claimedInputs, []);
  assert.deepEqual(releasedClaims, []);
  assert.deepEqual(writes, []);
});

test("a busy final write releases the signal for the client retry", async () => {
  configRows = [{ source: BOARD_MEMORY_CONFIG_SOURCE }];
  lockError = new StubBoardMemoryBusyError("Board memory is busy");
  const input = {
    projectId: 15,
    signal: {
      type: "edited_ai_title",
      originalText: "Customer import",
      correctedText: "Member import",
    },
    userId: 6,
  };

  await assert.rejects(learnBoardMemoryFromSignal(input), /busy/);

  assert.equal(generateCalls, 1);
  assert.deepEqual(releasedClaims, [{ input, token: "claim-token" }]);
  assert.deepEqual(writes, []);
});

test("enabling memory stores its opt-in marker through the vector write path", async () => {
  const result = await setBoardMemoryEnabled({
    enabled: true,
    projectId: 15,
    userId: 6,
  });

  assert.deepEqual(result, { enabled: true });
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0].source, BOARD_MEMORY_CONFIG_SOURCE);
  assert.deepEqual(leaseChecks, [15]);
});

test("disabling memory deletes its opt-in marker without writing", async () => {
  configRows = [{ source: BOARD_MEMORY_CONFIG_SOURCE }];

  const result = await setBoardMemoryEnabled({
    enabled: false,
    projectId: 15,
    userId: 6,
  });

  assert.deepEqual(result, { enabled: false });
  assert.deepEqual(deletes, [
    { projectId: 15, source: BOARD_MEMORY_CONFIG_SOURCE },
  ]);
  assert.deepEqual(revisionBumps, [15]);
  assert.deepEqual(leaseChecks, [15]);
  assert.deepEqual(writes, []);
});

test("deleting a fact uses the same board lock as learning", async () => {
  const source = `hypertask-memory:${"a".repeat(32)}`;

  const result = await deleteBoardMemory({
    projectId: 15,
    source,
    userId: 6,
  });

  assert.deepEqual(result, { success: true });
  assert.deepEqual(lockCalls, [15]);
  assert.deepEqual(revisionBumps, [15]);
  assert.deepEqual(leaseChecks, [15]);
  assert.deepEqual(deletes, [{ projectId: 15, source }]);
});

test("denied access prevents memory toggle side effects", async () => {
  accessError = new Error("Project not found or access denied");

  await assert.rejects(
    setBoardMemoryEnabled({ enabled: true, projectId: 15, userId: 6 }),
    /access denied/,
  );

  assert.deepEqual(lockCalls, []);
  assert.deepEqual(revisionBumps, []);
  assert.deepEqual(writes, []);
});

test("denied access prevents memory deletion side effects", async () => {
  accessError = new Error("Project not found or access denied");

  await assert.rejects(
    deleteBoardMemory({
      projectId: 15,
      source: `hypertask-memory:${"a".repeat(32)}`,
      userId: 6,
    }),
    /access denied/,
  );

  assert.deepEqual(lockCalls, []);
  assert.deepEqual(revisionBumps, []);
  assert.deepEqual(deletes, []);
});
