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
  assert.equal(isLiveTaskListRequest("Are there tasks on this board?"), true);
  assert.equal(isLiveTaskListRequest("Do tasks exist on this board?"), true);
  assert.equal(isLiveTaskListRequest("Is there a task on this board?"), true);
  assert.equal(isLiveTaskListRequest("What tasks are on this board?"), true);
  assert.equal(isLiveTaskListRequest("Which tasks are high priority?"), true);
  assert.equal(isLiveTaskListRequest("List all tasks across all boards"), true);
  assert.equal(isLiveTaskListRequest("List the tasks on my current board"), true);
});

test("other task intents keep their specialized tools", () => {
  assert.equal(isLiveTaskListRequest("Find tasks mentioning payment gateway"), false);
  assert.equal(isLiveTaskListRequest("How many tasks mention payment gateway?"), false);
  assert.equal(isLiveTaskListRequest("What's happening with the auth bug?"), false);
  assert.equal(isLiveTaskListRequest("What is this task's status?"), false);
  assert.equal(isLiveTaskListRequest("Count comments on this task"), false);
  assert.equal(isLiveTaskListRequest("How many tasks do I have?"), false);
  assert.equal(isLiveTaskListRequest("Show my highest priority tasks"), false);
  assert.equal(isLiveTaskListRequest("How many tasks am I assigned?"), false);
  assert.equal(isLiveTaskListRequest("Which tasks am I responsible for?"), false);
  assert.equal(isLiveTaskListRequest("What tasks can I create?"), false);
  assert.equal(isLiveTaskListRequest("How many tasks can I create?"), false);
  assert.equal(isLiveTaskListRequest("Show me how to create tasks"), false);
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
      message: "List all tasks across all boards",
      defaultProjectId: 42,
    }),
    undefined,
  );
  assert.equal(
    resolveLiveTaskListProjectId({
      message: "List tasks across every project",
      defaultProjectId: 42,
    }),
    undefined,
  );
  assert.equal(
    resolveLiveTaskListProjectId({
      message: "List all project tasks in the current project",
      defaultProjectId: 42,
    }),
    42,
  );
  assert.equal(
    resolveLiveTaskListProjectId({
      message: "List the tasks on my current board",
      defaultProjectId: 42,
    }),
    42,
  );
  assert.equal(
    resolveLiveTaskListProjectId({
      message: "Find tasks mentioning payment gateway",
      defaultProjectId: 42,
    }),
    undefined,
  );
  assert.equal(
    resolveLiveTaskListProjectId({
      message: "How many tasks am I assigned?",
      defaultProjectId: 42,
    }),
    undefined,
  );
  assert.equal(
    resolveLiveTaskListProjectId({
      message: "Show my highest priority tasks",
      defaultProjectId: 42,
    }),
    undefined,
  );
  assert.equal(
    resolveLiveTaskListProjectId({
      message: "What tasks can I create?",
      defaultProjectId: 42,
    }),
    undefined,
  );
});
