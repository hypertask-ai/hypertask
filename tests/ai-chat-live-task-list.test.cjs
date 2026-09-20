const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  alias: { "@": path.join(root, "src") },
  cache: false,
  interopDefault: true,
});
const {
  isLiveTaskListRequest,
  resolveLiveTaskListProjectId,
} = jiti(
  path.join(root, "src/app/api/ai/chat/stream/liveTaskList.ts"),
);

test("board-wide task questions require the live task list", () => {
  assert.equal(isLiveTaskListRequest("List the tasks on this board"), true);
  assert.equal(isLiveTaskListRequest("How many tickets are on the current board?"), true);
  assert.equal(isLiveTaskListRequest("Show all high priority cards"), true);
});

test("semantic task searches still use search or RAG", () => {
  assert.equal(isLiveTaskListRequest("Find tasks mentioning payment gateway"), false);
  assert.equal(isLiveTaskListRequest("What's happening with the auth bug?"), false);
});

test("AI chat enforces live listing and rejects RAG for board-wide task questions", () => {
  const route = fs.readFileSync(
    path.join(root, "src/app/api/ai/chat/stream/route.ts"),
    "utf8",
  );

  assert.match(
    route,
    /const targetProjectId = resolveLiveTaskListProjectId\(\{/,
  );
  assert.match(
    route,
    /if \(isLiveTaskListRequest\(body\.message\)\) \{[\s\S]*?semantic search cannot prove that a board is empty/,
  );
});

test("live task listing defaults to the visible board without overriding explicit scope", () => {
  assert.equal(
    resolveLiveTaskListProjectId({
      message: "List the tasks on this board",
      defaultProjectId: 42,
    }),
    42,
  );
  assert.equal(
    resolveLiveTaskListProjectId({
      message: "List all tasks",
      projectId: 73,
      defaultProjectId: 42,
    }),
    73,
  );
  assert.equal(
    resolveLiveTaskListProjectId({
      message: "Find tasks mentioning payment gateway",
      defaultProjectId: 42,
    }),
    undefined,
  );
});
