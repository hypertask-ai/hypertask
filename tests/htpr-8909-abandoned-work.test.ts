import assert from "node:assert/strict";
import test from "node:test";
import { BOARDS, capacityLimit, capacityWarning, commitIfStillAbandoned, decideAbandoned, handCount, planBoard, releaseNote, sampleRow, shouldPostCapacityWarning } from "../src/lib/abandonedWork/policy";

const NOW = Date.parse("2026-11-07T12:00:00.000Z");
const QUIET = "2026-11-07T00:00:00.000Z";
const FRESH = "2026-11-07T11:00:00.000Z";
const DAY = "2026-11-06T11:00:00.000Z";
const board = BOARDS[0];
const agent = (at = QUIET) => ({ userId: 6, agentId: "runner", assignedAt: at });
const url = "https://github.com/hypertask-ai/hypertask/pull/9";

test("the capacity warning names the column the board actually works in", () => {
  assert.match(capacityWarning(BOARDS[0], 9, 1), /board 15 has 9 tickets in In Progress/);
  assert.match(capacityWarning(BOARDS[1], 4, 1), /board 2060 has 4 tickets in Doing/);
  assert.doesNotMatch(capacityWarning(BOARDS[1], 4, 1), /In Progress/);
});

test("quiet work returns, active work stays, and a fresh reread is not released", async () => {
  assert.deepEqual(decideAbandoned(sampleRow({ sectionChangedAt: QUIET, assignees: [agent()], sectionEvents: [{ from: "Bugs", to: "In Progress", at: QUIET }] }), NOW, board), { action: "release", toSection: "Bugs", reason: "quiet for 6 hours", pullRequestUrls: [] });
  assert.deepEqual(decideAbandoned(sampleRow({ sectionChangedAt: QUIET, lastCommentAt: FRESH, assignees: [agent()] }), NOW, board), { action: "keep", reason: "owner still active" });
  assert.deepEqual(decideAbandoned(sampleRow({ sectionChangedAt: DAY, assignees: [{ userId: 42, agentId: null, assignedAt: DAY }, agent()] }), NOW, board), { action: "keep", reason: "human assignee" });
  assert.deepEqual(decideAbandoned(sampleRow({ sectionChangedAt: FRESH, assignees: [], sectionEvents: [{ from: "Improvements", to: "In Progress", at: FRESH }] }), NOW, board), { action: "release", toSection: "Improvements", reason: "unassigned", pullRequestUrls: [] });
  assert.deepEqual(decideAbandoned(sampleRow({ sectionChangedAt: QUIET, lastRunAt: FRESH, assignees: [] }), NOW, board), { action: "keep", reason: "active run" });
  assert.deepEqual(decideAbandoned(sampleRow({ sectionChangedAt: QUIET, assignees: [agent()], pullRequests: [{ url, lifecycle: "open", updatedAt: QUIET }] }), NOW, board), { action: "keep", reason: "open change still active" });
  const expired = decideAbandoned(sampleRow({ sectionChangedAt: DAY, assignees: [agent(DAY)], pullRequests: [{ url, lifecycle: "open", updatedAt: DAY }, { url: "https://github.com/hypertask-ai/hypertask/pull/3", lifecycle: "merged", updatedAt: DAY }] }), NOW, board);
  assert.deepEqual(expired, { action: "release", toSection: "Improvements", reason: "open change quiet for 24 hours", pullRequestUrls: [url] });
  assert.match(releaseNote("Improvements", [url]), /pull\/9/);
  assert.equal(BOARDS[1].inProgress, "Doing");
  assert.deepEqual(decideAbandoned(sampleRow({ projectId: 2060, section: "Doing", sectionChangedAt: QUIET, assignees: [agent()] }), NOW, BOARDS[1]), { action: "release", toSection: "Todo", reason: "quiet for 6 hours", pullRequestUrls: [] });
  assert.deepEqual(decideAbandoned(sampleRow({ projectId: 2060, section: "In Progress", sectionChangedAt: QUIET, assignees: [agent()] }), NOW, BOARDS[1]), { action: "keep", reason: "not in progress" });
  assert.deepEqual(decideAbandoned(sampleRow({ projectId: 2060, section: "Doing", sectionChangedAt: QUIET, assignees: [agent()], comments: [{ id: 3, createdAt: QUIET, text: "<p>Question: Which column?</p>", commentText: "Question: Which column?", creatorId: 6, agentId: "runner", agentDisplayName: "Runner", kind: "question", reactions: [] }] }), NOW, BOARDS[1]), { action: "release", toSection: "Valentin Review", reason: "quiet for 6 hours", pullRequestUrls: [] });
  const formatted = decideAbandoned(sampleRow({ projectId: 2060, section: "Doing", sectionChangedAt: QUIET, assignees: [agent()], comments: [{ id: 9, createdAt: QUIET, text: "<p><strong>Question:</strong> Ship?</p>", commentText: "", creatorId: 9, agentId: "runner", agentDisplayName: "Runner", kind: null, reactions: [] }] }), NOW, BOARDS[1]);
  assert.deepEqual(formatted, { action: "release", toSection: "Valentin Review", reason: "quiet for 6 hours", pullRequestUrls: [] });
  const liked = decideAbandoned(sampleRow({ sectionChangedAt: QUIET, assignees: [], sectionEvents: [{ from: "Features", to: "In Progress", at: QUIET }], comments: [{ id: 4, createdAt: QUIET, text: "<p>Question: Ship this?</p>", commentText: "Question: Ship this?", creatorId: 6, agentId: "runner", agentDisplayName: "Runner", kind: "question", reactions: [{ emoji: "👍", at: FRESH }] }] }), NOW, board);
  assert.deepEqual(liked, { action: "release", toSection: "Features", reason: "unassigned", pullRequestUrls: [] });
  assert.deepEqual(decideAbandoned(sampleRow({ sectionChangedAt: DAY, liveLeaseAt: FRESH, assignees: [agent(DAY)] }), NOW, board), { action: "keep", reason: "active lease" });
  const rows = [
    sampleRow({ id: 1, sectionChangedAt: QUIET, assignees: [agent()], sectionEvents: [{ from: "Bugs", to: "In Progress", at: QUIET }] }),
    sampleRow({ id: 2, sectionChangedAt: QUIET, lastRunAt: FRESH, assignees: [agent()] }),
    sampleRow({ id: 4, sectionChangedAt: FRESH, assignees: [] }),
    sampleRow({ id: 9, sectionChangedAt: QUIET, lastRunAt: FRESH, assignees: [] }),
  ];
  const plan = planBoard(rows, NOW, board);
  assert.deepEqual(plan.ok ? plan.releases.map((release) => release.id) : [], [1, 4]);
  assert.equal(handCount(rows, NOW, board), 2);
  let applied = false;
  const kept = await commitIfStillAbandoned(rows[0], NOW, board, {
    lockAndReread: async () => sampleRow({ id: 1, sectionChangedAt: QUIET, lastCommentAt: FRESH, assignees: [agent()] }),
    apply: async () => { applied = true; },
  });
  assert.equal(`${kept}:${applied}`, "kept:false");
  assert.equal(capacityLimit(13), 16);
  assert.equal(shouldPostCapacityWarning(17, 13, 0) && !shouldPostCapacityWarning(17, 13, 1), true);
});
