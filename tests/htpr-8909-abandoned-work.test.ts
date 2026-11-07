import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BOARDS,
  capacityLimit,
  commitIfStillAbandoned,
  decideAbandoned,
  handCount,
  planBoard,
  proveResumedWorkSurvives,
  releaseNote,
  sampleRow,
  shouldPostCapacityWarning,
  type AbandonedRow,
} from "../src/lib/abandonedWork/policy";

const NOW = Date.parse("2026-11-07T12:00:00.000Z");
const QUIET = "2026-11-07T00:00:00.000Z";
const FRESH = "2026-11-07T11:00:00.000Z";
const DAY = "2026-11-06T11:00:00.000Z";
const board = BOARDS[0];
const infra = BOARDS[1];

function agent(at = QUIET): AbandonedRow["assignees"][number] {
  return { userId: 6, agentId: "runner-13", assignedAt: at };
}

function human(at = QUIET): AbandonedRow["assignees"][number] {
  return { userId: 42, agentId: null, assignedAt: at };
}

test("six quiet hours without an open change returns the ticket to its intake", () => {
  const row = sampleRow({
    sectionChangedAt: QUIET,
    assignees: [agent()],
    sectionEvents: [{ from: "Bugs", to: "In Progress", at: QUIET }],
  });
  const decision = decideAbandoned(row, NOW, board);
  assert.equal(decision.action, "release");
  if (decision.action !== "release") return;
  assert.equal(decision.toSection, "Bugs");
  assert.equal(decision.reason, "quiet for 6 hours");
  assert.deepEqual(decision.pullRequestUrls, []);
});

test("a fresh owner stays", () => {
  const decision = decideAbandoned(sampleRow({
    sectionChangedAt: QUIET,
    lastCommentAt: FRESH,
    assignees: [agent()],
  }), NOW, board);
  assert.deepEqual(decision, { action: "keep", reason: "owner still active" });
});

test("a human assignee stays even after a long quiet period", () => {
  const decision = decideAbandoned(sampleRow({
    sectionChangedAt: "2026-11-01T00:00:00.000Z",
    assignees: [human(), agent()],
  }), NOW, board);
  assert.deepEqual(decision, { action: "keep", reason: "human assignee" });
});

test("an unassigned ticket returns immediately", () => {
  const decision = decideAbandoned(sampleRow({
    sectionChangedAt: FRESH,
    assignees: [],
    sectionEvents: [{ from: "Improvements", to: "In Progress", at: FRESH }],
  }), NOW, board);
  assert.equal(decision.action, "release");
  if (decision.action !== "release") return;
  assert.equal(decision.reason, "unassigned");
  assert.equal(decision.toSection, "Improvements");
});

test("an open change protects an active owner and expires after twenty-four quiet hours", () => {
  const url = "https://github.com/hypertask-ai/hypertask/pull/9";
  const active = decideAbandoned(sampleRow({
    sectionChangedAt: QUIET,
    assignees: [agent()],
    pullRequests: [{ url, lifecycle: "open", updatedAt: QUIET }],
  }), NOW, board);
  assert.deepEqual(active, { action: "keep", reason: "open change still active" });
  const expired = decideAbandoned(sampleRow({
    sectionChangedAt: DAY,
    assignees: [agent(DAY)],
    pullRequests: [
      { url, lifecycle: "open", updatedAt: DAY },
      { url: "https://github.com/hypertask-ai/hypertask/pull/3", lifecycle: "merged", updatedAt: DAY },
    ],
  }), NOW, board);
  assert.equal(expired.action, "release");
  if (expired.action !== "release") return;
  assert.equal(expired.reason, "open change quiet for 24 hours");
  assert.deepEqual(expired.pullRequestUrls, [url]);
  assert.match(releaseNote(expired.toSection, expired.pullRequestUrls), new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("an unanswered owner question goes to Valentin Review", () => {
  const decision = decideAbandoned(sampleRow({
    projectId: 4060,
    sectionChangedAt: QUIET,
    assignees: [agent()],
    comments: [{
      id: 3,
      createdAt: QUIET,
      text: "<p>Question: Which column should this use?</p>",
      commentText: "Question: Which column should this use?",
      creatorId: 6,
      agentId: "runner-13",
      agentDisplayName: "Runner 13",
      kind: "question",
      reactions: [],
    }],
  }), NOW, infra);
  assert.equal(decision.action, "release");
  if (decision.action !== "release") return;
  assert.equal(decision.toSection, "Valentin Review");
});

test("a thumbs-up after the question keeps the intake column", () => {
  const decision = decideAbandoned(sampleRow({
    sectionChangedAt: QUIET,
    assignees: [],
    sectionEvents: [{ from: "Features", to: "In Progress", at: QUIET }],
    comments: [{
      id: 4,
      createdAt: QUIET,
      text: "<p>Question: Ship this?</p>",
      commentText: "Question: Ship this?",
      creatorId: 6,
      agentId: "runner-13",
      agentDisplayName: "Runner 13",
      kind: "question",
      reactions: [{ emoji: "👍", at: FRESH }],
    }],
  }), NOW, board);
  assert.equal(decision.action, "release");
  if (decision.action !== "release") return;
  assert.equal(decision.toSection, "Features");
});

test("an active lease stays", () => {
  const decision = decideAbandoned(sampleRow({
    sectionChangedAt: "2026-11-01T00:00:00.000Z",
    liveLeaseAt: FRESH,
    assignees: [agent("2026-11-01T00:00:00.000Z")],
  }), NOW, board);
  assert.deepEqual(decision, { action: "keep", reason: "active lease" });
});

test("the preview matches the separate hand count, and a resumed reread is not released", async () => {
  const rows = [
    sampleRow({ id: 1, sectionChangedAt: QUIET, assignees: [agent()], sectionEvents: [{ from: "Bugs", to: "In Progress", at: QUIET }] }),
    sampleRow({ id: 2, sectionChangedAt: QUIET, lastRunAt: FRESH, assignees: [agent()] }),
    sampleRow({ id: 3, sectionChangedAt: QUIET, assignees: [human()] }),
    sampleRow({ id: 4, sectionChangedAt: FRESH, assignees: [] }),
    sampleRow({ id: 5, sectionChangedAt: QUIET, assignees: [agent()], pullRequests: [{ url: "https://github.com/hypertask-ai/hypertask/pull/5", lifecycle: "open", updatedAt: QUIET }] }),
    sampleRow({ id: 6, sectionChangedAt: DAY, assignees: [agent(DAY)], pullRequests: [{ url: "https://github.com/hypertask-ai/hypertask/pull/6", lifecycle: "open", updatedAt: DAY }] }),
    sampleRow({ id: 7, projectId: 15, section: "QA", assignees: [agent()] }),
    sampleRow({ id: 8, sectionChangedAt: QUIET, liveLeaseAt: FRESH, assignees: [agent()] }),
  ];
  const plan = planBoard(rows, NOW, board);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(plan.releases.map((release) => release.id), [1, 4, 6]);
  assert.equal(handCount(rows, NOW, board), 3);
  assert.equal(await proveResumedWorkSurvives(), true);
  let applied = false;
  const survived = await commitIfStillAbandoned(rows[0], NOW, board, {
    lockAndReread: async () => sampleRow({
      id: 1,
      sectionChangedAt: QUIET,
      lastCommentAt: FRESH,
      assignees: [agent()],
    }),
    apply: async () => {
      applied = true;
    },
  });
  assert.equal(survived, "kept");
  assert.equal(applied, false);
});

test("writers and the sweep share one task lock, and each board is read once", () => {
  const fence = readFileSync("src/lib/mcp/tasks/agentMutationFence.ts", "utf8");
  assert.match(fence, /pg_advisory_xact_lock/);
  assert.match(fence, /SELECT id FROM "Task" WHERE id = \$\{taskId\} FOR UPDATE/);
  assert.match(readFileSync("src/lib/agentRuns/persistence.ts", "utf8"), /lockAgentMutationFence\(tx, input\.context\.taskId\)/);
  assert.match(readFileSync("src/lib/pullRequests/syncTaskPullRequests.ts", "utf8"), /lockAgentMutationFence\(transaction, taskId\)/);
  const sweep = readFileSync("src/lib/abandonedWork/sweep.ts", "utf8");
  assert.equal(sweep.match(/await readBoardOnce\(/g)?.length, 1);
  assert.match(sweep, /lockAgentMutationFence\(tx, row\.id\)/);
  assert.match(readFileSync("vercel.json", "utf8"), /"path": "\/api\/cron\/abandoned-work"/);
  assert.match(readFileSync("src/app/api/cron/abandoned-work/route.ts", "utf8"), /HTPR_8909_ABANDONED_WORK_FLAG|sweepAbandonedWork/);
});

test("capacity allows live runners plus three and warns once", () => {
  assert.equal(capacityLimit(13), 16);
  assert.equal(shouldPostCapacityWarning(17, 13, 0), true);
  assert.equal(shouldPostCapacityWarning(16, 13, 0), false);
  assert.equal(shouldPostCapacityWarning(17, 13, 1), false);
});
