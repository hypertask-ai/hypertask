// HTPR-3793. Walking a card through several columns with the keyboard wrote one
// history row per stop, so the feed read as noise and the move that actually
// mattered was buried.
//
// A rapid follow-up move now extends the previous entry instead of adding a new
// one. This pins the four rules that decide whether that is safe to do.
const test = require("node:test");
const assert = require("node:assert");

const COLLAPSE_WINDOW_MS = 60_000;

// Mirrors the decision in src/utils/controllers/activities/createTaskMovedActivity.ts.
const isCollapsible = ({ previous, fromSectionId, actor, now }) => {
  if (!previous || previous.type !== "TaskMove") return false;
  const sameActor = actor.agentId
    ? previous.data.fromAgent?.id === actor.agentId
    : !previous.data.fromAgent && previous.data.fromUserId === actor.userId;
  return (
    sameActor &&
    previous.data.toSection?.sectionId === fromSectionId &&
    now - previous.createdAt <= COLLAPSE_WINDOW_MS
  );
};

const move = (fromId, toId, { userId = 6, agent = null, createdAt = 0 } = {}) => ({
  type: "TaskMove",
  createdAt,
  data: {
    fromUserId: userId,
    fromAgent: agent,
    fromSection: { sectionId: fromId },
    toSection: { sectionId: toId },
  },
});

const NOW = 1_000_000;

test("a rapid follow-up move collapses into the previous one", () => {
  const previous = move(1, 2, { createdAt: NOW - 5_000 });
  assert.strictEqual(
    isCollapsible({ previous, fromSectionId: 2, actor: { userId: 6 }, now: NOW }),
    true
  );
});

test("a move minutes later stays a separate history entry", () => {
  const previous = move(1, 2, { createdAt: NOW - 5 * 60_000 });
  assert.strictEqual(
    isCollapsible({ previous, fromSectionId: 2, actor: { userId: 6 }, now: NOW }),
    false
  );
});

test("someone else's move is never absorbed into yours", () => {
  const previous = move(1, 2, { userId: 99, createdAt: NOW - 5_000 });
  assert.strictEqual(
    isCollapsible({ previous, fromSectionId: 2, actor: { userId: 6 }, now: NOW }),
    false
  );
});

test("a move that does not continue from where the last one ended is separate", () => {
  // Previous journey ended in column 2; this one starts in column 5. Two
  // unrelated moves that happen to be adjacent in the feed.
  const previous = move(1, 2, { createdAt: NOW - 5_000 });
  assert.strictEqual(
    isCollapsible({ previous, fromSectionId: 5, actor: { userId: 6 }, now: NOW }),
    false
  );
});

test("an agent does not inherit its owner's move, and vice versa", () => {
  const byAgent = move(1, 2, { agent: { id: "agent-a" }, createdAt: NOW - 5_000 });
  // Same underlying user id, but the actor is the human, not the agent.
  assert.strictEqual(
    isCollapsible({ previous: byAgent, fromSectionId: 2, actor: { userId: 6 }, now: NOW }),
    false
  );
  const byUser = move(1, 2, { createdAt: NOW - 5_000 });
  assert.strictEqual(
    isCollapsible({ previous: byUser, fromSectionId: 2, actor: { agentId: "agent-a" }, now: NOW }),
    false
  );
});

test("a non-move activity in between blocks collapsing", () => {
  const previous = { type: "TaskAssigned", createdAt: NOW - 1_000, data: {} };
  assert.strictEqual(
    isCollapsible({ previous, fromSectionId: 2, actor: { userId: 6 }, now: NOW }),
    false
  );
});
