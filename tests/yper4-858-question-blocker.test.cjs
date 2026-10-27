const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const { prepareCommentNotifications } = load("src/utils/controllers/comments/prepareCommentNotifications.ts", {});

async function reply({ agentId = null, creatorId = 6, concurrentQuestion = false } = {}) {
  const before = { waitingOnUserId: 6, waitingOnSetAt: new Date("2026-10-27T12:00:00Z"), blockerCommentId: 10 };
  const state = { ...before };
  if (concurrentQuestion) {
    state.waitingOnSetAt = new Date("2026-10-27T12:01:00Z");
    state.blockerCommentId = 11;
  }
  const events = [];
  await prepareCommentNotifications({
    task: { id: 42, projectId: 15, ...before }, taskId: 42, creatorId, creatorIdNum: creatorId,
    agentId, hyperAiId: 99,
    transactionResult: { comment: { id: 12, text: "Yes", createdAt: new Date() } },
    dependencies: {
      recordHyperAiCommentOrigin: async () => {},
      scheduleCommentSummaryGeneration: async () => {},
      upsertCommentToTurbopuffer: async () => {},
      scheduleTaskSummaryGeneration: async () => {},
      broadcastInboxChange: (id) => events.push(["inbox", id]),
      broadcastBoardChange: (id) => events.push(["board", id]),
      prisma: { task: {
        update: async () => {},
        updateMany: async ({ where, data }) => {
          if (Object.entries(where).some(([key, value]) => key !== "id" && String(state[key]) !== String(value))) return { count: 0 };
          Object.assign(state, data);
          return { count: 1 };
        },
      } },
    },
  });
  return { state, events };
}

test("a person's answer clears both the waiting person and question marker", async () => {
  const { state, events } = await reply();
  assert.deepEqual(state, { waitingOnUserId: null, waitingOnSetAt: null, waitingOnSetById: null, blockerCommentId: null });
  assert.deepEqual(events, [["inbox", 6], ["board", 15]]);
});

for (const options of [{ agentId: "runner" }, { creatorId: 7 }, { concurrentQuestion: true }]) {
  test(`an unrelated reply cannot clear a pending question: ${JSON.stringify(options)}`, async () => {
    assert.equal((await reply()).state.blockerCommentId, null);
    const { state, events } = await reply(options);
    assert.equal(state.waitingOnUserId, 6);
    assert.equal(state.blockerCommentId, options.concurrentQuestion ? 11 : 10);
    assert.deepEqual(events, []);
  });
}

test("five consecutive vcc questions mark blockers while ordinary comments and refusals stay safe", { timeout: 90_000 }, () => {
  const result = spawnSync("bash", [path.join(__dirname, "../.claude/skills/vcc/bin/vcc.test.sh")], {
    encoding: "utf8", timeout: 80_000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /ok five consecutive questions set combined person\/comment blockers/);
  assert.match(result.stdout, /ok blocker failures fail closed; ordinary comments stay unchanged/);
});
