const assert = require("node:assert/strict");
const test = require("node:test");
const { Prisma } = require("@prisma/client");
const { load } = require("./task-route-loader.cjs");
const { matches, hydrate } = require("./helpers/agent-board-scope.cjs");

const at = (minute) => new Date(`2026-10-24T10:${String(minute).padStart(2, "0")}:00Z`);
const question = (overrides = {}) => ({
  id: 10, text: "<p><strong>Question:</strong> Ship this?</p>", commentText: "Question: Ship this?",
  creatorId: 6, agentId: "runner", agentDisplayName: "Runner", createdAt: at(10),
  activity: Prisma.DbNull, reactions: [], ...overrides,
});
const reply = (overrides = {}) => question({
  id: 11, text: "Yes", commentText: "Yes", agentId: null, agentDisplayName: null,
  createdAt: at(20), ...overrides,
});
const reaction = (overrides = {}) => ({
  userId: 6, agentId: null, agentDisplayName: null, isDeleted: false,
  emoji: "👍", createdAt: at(20), updatedAt: null, ...overrides,
});
const task = (overrides = {}) => ({
  id: 42, projectId: 15, status: "Normal", section: "Valentin Review",
  waitingOnUserId: 6, waitingOnSetById: 7, waitingOnSetAt: at(0),
  comments: [question()], sectionEvents: [], ...overrides,
});

function fixture(tasks) {
  const boards = [], inboxes = [], tickets = [], writes = [];
  const db = {
    $transaction: async (run, options) => {
      assert.equal(options.isolationLevel, "Serializable");
      return run(db);
    },
    task: {
      findMany: async (args) => {
        assert.equal(args.select.comments.where.activity.equals, Prisma.DbNull);
        return tasks.filter((row) => matches(row, args.where)).map((row) => hydrate({
          ...row,
          comments: row.comments.filter((comment) => comment.activity === Prisma.DbNull)
            .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id),
        }, args));
      },
      update: async ({ where, data }) => {
        writes.push(data);
        return Object.assign(tasks.find((row) => row.id === where.id), data);
      },
    },
  };
  const { sweepValentinWaitingOn } = load("src/utils/controllers/tasks/sweepValentinWaitingOn.ts", {
    "@/lib/prisma": { default: db },
    "@/lib/realtime/server": {
      broadcastBoardChange: (id) => boards.push(id),
      broadcastInboxChange: (id) => inboxes.push(id),
      broadcastTaskChange: (id) => tickets.push(id),
    },
  });
  return { sweep: sweepValentinWaitingOn, boards, inboxes, tickets, writes };
}

for (const [name, comments] of [
  ["comment", [question(), reply()]],
  ["thumbs up", [question({ reactions: [reaction()] })]],
  ["skin-tone thumbs up", [question({ reactions: [reaction({ emoji: "👍🏽" })] })]],
]) {
  test(`Valentin's ${name} after the last agent Question clears all waiting-on fields`, async () => {
    const row = task({ comments }), f = fixture([row]);
    assert.equal(await f.sweep(), 1);
    assert.deepEqual([row.waitingOnUserId, row.waitingOnSetById, row.waitingOnSetAt], [null, null, null]);
    assert.deepEqual([f.boards, f.inboxes, f.tickets], [[15], [6], [42]]);
  });

  test(`Valentin's ${name} also clears an explicit wait outside review columns`, async () => {
    const row = task({ comments, section: "In Progress" });
    assert.equal(await fixture([row]).sweep(), 1);
    assert.deepEqual([row.waitingOnUserId, row.waitingOnSetById, row.waitingOnSetAt], [null, null, null]);
  });

  test(`still-cleared: an answered ticket stays cleared in its waiting column after a ${name}`, async () => {
    const row = task({ comments, waitingOnUserId: null, waitingOnSetById: null, waitingOnSetAt: null });
    const f = fixture([row]);
    assert.equal(await f.sweep(), 0);
    assert.equal(await f.sweep(), 0);
    assert.deepEqual([row.waitingOnUserId, row.waitingOnSetById, row.waitingOnSetAt], [null, null, null]);
    assert.deepEqual(f.writes, []);
  });
}

for (const [name, comments] of [
  ["no reply", [question()]],
  ["reply predates the latest Question", [question({ id: 12, createdAt: at(30) }), reply()]],
  ["thumbs up is on an older Question", [question({ reactions: [reaction()] }), question({ id: 12, createdAt: at(30) })]],
  ["reply is from another human", [question(), reply({ creatorId: 7 })]],
  ["reply is from Valentin's agent", [question(), reply({ agentId: "other-runner" })]],
  ["reply is from a deleted agent", [question(), reply({ agentDisplayName: "Deleted runner" })]],
  ["reply is an activity", [question(), reply({ activity: { type: "TaskMoved" } })]],
  ["thumbs up is from another human", [question({ reactions: [reaction({ userId: 7 })] })]],
  ["thumbs up is from an agent", [question({ reactions: [reaction({ agentId: "runner" })] })]],
  ["thumbs up is from a deleted agent", [question({ reactions: [reaction({ agentDisplayName: "Deleted runner" })] })]],
  ["thumbs up was removed", [question({ reactions: [reaction({ isDeleted: true })] })]],
  ["reaction is not a thumbs up", [question({ reactions: [reaction({ emoji: "👎" })] })]],
]) {
  test(`still-kept: waiting-on remains unchanged when ${name}`, async () => {
    const row = task({ comments }), f = fixture([row]);
    assert.equal(await f.sweep(), 0);
    assert.deepEqual([row.waitingOnUserId, row.waitingOnSetById, row.waitingOnSetAt], [6, 7, at(0)]);
    assert.deepEqual(f.writes, []);
  });
}

for (const section of ["Valentin Review", "UX Sign-off", "Flags"]) {
  test(`entering ${section} sets waiting-on once without resetting its age`, async () => {
    const row = task({ section, waitingOnUserId: null, waitingOnSetById: null, waitingOnSetAt: null });
    const f = fixture([row]);
    assert.equal(await f.sweep(), 1);
    const setAt = row.waitingOnSetAt;
    assert.ok(setAt instanceof Date);
    assert.equal(row.waitingOnUserId, 6);
    assert.equal(row.waitingOnSetById, null);
    assert.equal(await f.sweep(), 0);
    assert.equal(row.waitingOnSetAt, setAt);
  });

  test(`leaving ${section} clears the previously backfilled Valentin mark`, async () => {
    const row = task({ section: "AI Review", sectionEvents: [{ from: section }] }), f = fixture([row]);
    assert.equal(await f.sweep(), 1);
    assert.deepEqual([row.waitingOnUserId, row.waitingOnSetById, row.waitingOnSetAt], [null, null, null]);
  });
}

test("a new agent Question after a reply reinstates the waiting-on mark", async () => {
  const row = task({ comments: [question(), reply()], waitingOnUserId: null, waitingOnSetById: null, waitingOnSetAt: null });
  const f = fixture([row]);
  assert.equal(await f.sweep(), 0);
  row.comments.push(question({ id: 12, createdAt: at(30) }));
  assert.equal(await f.sweep(), 1);
  assert.equal(row.waitingOnUserId, 6);
});

test("the latest Question wins even when timestamps tie", async () => {
  const row = task({ comments: [question({ reactions: [reaction()] }), question({ id: 12 })] });
  assert.equal(await fixture([row]).sweep(), 0);
  assert.equal(row.waitingOnUserId, 6);
});

test("comment ids disambiguate a reply at the same timestamp as the Question", async () => {
  for (const [id, expected] of [[9, 6], [11, null]]) {
    const row = task({ comments: [question(), reply({ id, createdAt: at(10) })] });
    assert.equal(await fixture([row]).sweep(), expected === null ? 1 : 0);
    assert.equal(row.waitingOnUserId, expected);
  }
});

test("a human Question does not hide Valentin's answer to the latest agent Question", async () => {
  const row = task({ comments: [question(), reply({ text: "Question: Anything else?", commentText: "Question: Anything else?" })] });
  assert.equal(await fixture([row]).sweep(), 1);
  assert.equal(row.waitingOnUserId, null);
});

test("a deleted agent's Question still accepts Valentin's reply", async () => {
  const row = task({ comments: [question({ agentId: null }), reply()] });
  assert.equal(await fixture([row]).sweep(), 1);
  assert.equal(row.waitingOnUserId, null);
});

test("column-only waits are set without a Question and cleared after leaving", async () => {
  const row = task({ comments: [], waitingOnUserId: null, waitingOnSetById: null, waitingOnSetAt: null });
  const f = fixture([row]);
  assert.equal(await f.sweep(), 1);
  assert.equal(row.waitingOnUserId, 6);
  row.section = "In Progress";
  assert.equal(await f.sweep(), 1);
  assert.equal(row.waitingOnUserId, null);
});

test("archived auto-managed waits are cleared", async () => {
  const row = task({ status: "Archive", waitingOnSetById: null }), f = fixture([row]);
  assert.equal(await f.sweep(), 1);
  assert.equal(row.waitingOnUserId, null);
});

test("other blockers, explicit waits outside review columns and unrelated boards are untouched", async () => {
  const rows = [
    task({ id: 1, waitingOnUserId: 8 }),
    task({ id: 2, section: "In Progress" }),
    task({ id: 3, projectId: 99, waitingOnUserId: null, waitingOnSetById: null, waitingOnSetAt: null }),
    task({ id: 4, projectId: 4060, waitingOnUserId: null, waitingOnSetById: null, waitingOnSetAt: null }),
  ];
  const f = fixture(rows);
  assert.equal(await f.sweep(), 1);
  assert.deepEqual(rows.map((row) => row.waitingOnUserId), [8, 6, null, 6]);
  assert.deepEqual(f.boards, [4060]);
});

test("a failed transaction emits no realtime changes", async () => {
  const broadcasts = [];
  const { sweepValentinWaitingOn } = load("src/utils/controllers/tasks/sweepValentinWaitingOn.ts", {
    "@/lib/prisma": { default: { $transaction: async () => { throw new Error("serialization conflict"); } } },
    "@/lib/realtime/server": {
      broadcastBoardChange: (...args) => broadcasts.push(args),
      broadcastInboxChange: (...args) => broadcasts.push(args),
      broadcastTaskChange: (...args) => broadcasts.push(args),
    },
  });
  await assert.rejects(sweepValentinWaitingOn(), /serialization conflict/);
  assert.deepEqual(broadcasts, []);
});
