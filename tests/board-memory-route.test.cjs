const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
let currentUser = null;
let authError = null;
let learnError = null;
const calls = [];
class StubBoardMemoryProjectAccessError extends Error {}

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

stubModule("src/app/api/ai/_lib/editorAi.ts", {
  getCurrentUserFromCookies: async () => {
    if (authError) throw authError;
    return currentUser;
  },
});
stubModule("src/app/api/ai/_lib/boardMemory.ts", {
  BoardMemoryProjectAccessError: StubBoardMemoryProjectAccessError,
  deleteBoardMemory: async (input) => {
    calls.push(["delete", input]);
    return { success: true };
  },
  getBoardMemoryState: async (userId, projectId) => {
    calls.push(["get", { projectId, userId }]);
    return { enabled: false, memories: [] };
  },
  learnBoardMemoryFromSignal: async (input) => {
    if (learnError) throw learnError;
    calls.push(["learn", input]);
    return { enabled: true, learned: ["Use member instead of customer."] };
  },
  setBoardMemoryEnabled: async (input) => {
    calls.push(["toggle", input]);
    return { enabled: input.enabled };
  },
});

const jiti = createJiti(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const route = jiti(path.join(root, "src/app/api/ai/project/memory/route.ts"));
const { BoardMemoryBusyError, BoardMemoryRateLimitError } = jiti(
  path.join(root, "src/app/api/ai/_lib/boardMemoryGuards.ts"),
);

test.beforeEach(() => {
  calls.length = 0;
  currentUser = null;
  authError = null;
  learnError = null;
});

test("board memory route rejects an anonymous request before reading memory", async () => {
  const response = await route.GET(
    new NextRequest(
      "https://app.hypertask.ai/api/ai/project/memory?projectId=15",
    ),
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
  assert.deepEqual(calls, []);
});

test("board memory route reads the authenticated user's requested board", async () => {
  currentUser = { id: 6 };
  const response = await route.GET(
    new NextRequest(
      "https://app.hypertask.ai/api/ai/project/memory?projectId=15",
    ),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: false, memories: [] });
  assert.deepEqual(calls, [["get", { projectId: 15, userId: 6 }]]);
});

test("board memory route rejects invalid board identifiers before access", async () => {
  currentUser = { id: 6 };
  const invalidProjectIds = [null, "0", "-1", "1.5", "not-a-board"];

  for (const projectId of invalidProjectIds) {
    const query = projectId === null ? "" : `?projectId=${projectId}`;
    const response = await route.GET(
      new NextRequest(`https://app.hypertask.ai/api/ai/project/memory${query}`),
    );
    assert.equal(response.status, 400, String(projectId));
  }

  assert.deepEqual(calls, []);
});

test("board memory route rejects every anonymous mutation", async () => {
  const source = `hypertask-memory:${"a".repeat(32)}`;
  const requests = [
    route.PATCH(
      new NextRequest("https://app.hypertask.ai/api/ai/project/memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, projectId: 15 }),
      }),
    ),
    route.POST(
      new NextRequest("https://app.hypertask.ai/api/ai/project/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: 15,
          type: "edited_ai_title",
          originalText: "Customer import",
          correctedText: "Member import",
        }),
      }),
    ),
    route.DELETE(
      new NextRequest(
        `https://app.hypertask.ai/api/ai/project/memory?projectId=15&source=${source}`,
        { method: "DELETE" },
      ),
    ),
  ];

  for (const response of await Promise.all(requests)) {
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Unauthorized" });
  }
  assert.deepEqual(calls, []);
});

test("board memory route hides authentication lookup failures", async () => {
  authError = new Error("cookie backend details");
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const response = await route.GET(
      new NextRequest(
        "https://app.hypertask.ai/api/ai/project/memory?projectId=15",
      ),
    );

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "Request failed" });
  } finally {
    console.error = originalConsoleError;
  }
});

test("board memory toggle uses the authenticated user and validated board", async () => {
  currentUser = { id: 6 };
  const response = await route.PATCH(
    new NextRequest("https://app.hypertask.ai/api/ai/project/memory", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, projectId: 15 }),
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: true });
  assert.deepEqual(calls, [
    ["toggle", { enabled: true, projectId: 15, userId: 6 }],
  ]);
});

test("board memory learning rejects an incomplete correction signal", async () => {
  currentUser = { id: 6 };
  const response = await route.POST(
    new NextRequest("https://app.hypertask.ai/api/ai/project/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: 15,
        type: "task_writer_correction",
        originalText: "Draft",
      }),
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(calls, []);
});

test("board memory learning forwards a valid correction with its user and board", async () => {
  currentUser = { id: 6 };
  const response = await route.POST(
    new NextRequest("https://app.hypertask.ai/api/ai/project/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: 15,
        type: "edited_ai_title",
        originalText: "Customer import",
        correctedText: "Member import",
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    enabled: true,
    learned: ["Use member instead of customer."],
  });
  assert.deepEqual(calls, [
    [
      "learn",
      {
        projectId: 15,
        signal: {
          type: "edited_ai_title",
          originalText: "Customer import",
          correctedText: "Member import",
        },
        userId: 6,
      },
    ],
  ]);
});

test("board memory learning returns retry guidance when its budget is spent", async () => {
  currentUser = { id: 6 };
  learnError = new BoardMemoryRateLimitError(27);
  const response = await route.POST(
    new NextRequest("https://app.hypertask.ai/api/ai/project/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: 15,
        type: "edited_ai_title",
        originalText: "Customer import",
        correctedText: "Member import",
      }),
    }),
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "27");
  assert.deepEqual(await response.json(), {
    error: "Board memory learning rate limit exceeded",
  });
});

test("board memory learning returns retry guidance while another change holds the lock", async () => {
  currentUser = { id: 6 };
  learnError = new BoardMemoryBusyError();
  const response = await route.POST(
    new NextRequest("https://app.hypertask.ai/api/ai/project/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: 15,
        type: "edited_ai_title",
        originalText: "Customer import",
        correctedText: "Member import",
      }),
    }),
  );

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "1");
  assert.deepEqual(await response.json(), { error: "Board memory is busy" });
});

test("board memory route treats malformed JSON as an invalid request", async () => {
  currentUser = { id: 6 };
  const response = await route.POST(
    new NextRequest("https://app.hypertask.ai/api/ai/project/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid request" });
});

test("board memory route hides unexpected internal error details", async () => {
  currentUser = { id: 6 };
  learnError = new Error("provider-key leaked in upstream failure");
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const response = await route.POST(
      new NextRequest("https://app.hypertask.ai/api/ai/project/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: 15,
          type: "edited_ai_title",
          originalText: "Customer import",
          correctedText: "Member import",
        }),
      }),
    );

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "Request failed" });
  } finally {
    console.error = originalConsoleError;
  }
});

test("board memory route maps typed project access failures to 404", async () => {
  currentUser = { id: 6 };
  learnError = new StubBoardMemoryProjectAccessError();
  const response = await route.POST(
    new NextRequest("https://app.hypertask.ai/api/ai/project/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: 15,
        type: "edited_ai_title",
        originalText: "Customer import",
        correctedText: "Member import",
      }),
    }),
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "Project not found or access denied",
  });
});

test("board memory deletion stays scoped to the authenticated board", async () => {
  currentUser = { id: 6 };
  const source = `hypertask-memory:${"a".repeat(32)}`;
  const response = await route.DELETE(
    new NextRequest(
      `https://app.hypertask.ai/api/ai/project/memory?projectId=15&source=${source}`,
      { method: "DELETE" },
    ),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [["delete", { projectId: 15, source, userId: 6 }]]);
});

test("board memory deletion rejects non-fact sources before storage", async () => {
  currentUser = { id: 6 };
  const response = await route.DELETE(
    new NextRequest(
      "https://app.hypertask.ai/api/ai/project/memory?projectId=15&source=hypertask-memory:config",
      { method: "DELETE" },
    ),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(calls, []);
});
