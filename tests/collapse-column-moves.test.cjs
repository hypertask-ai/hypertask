const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.join(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const {
  STATUS_FLIP_COLLAPSE_WINDOW_MS,
  classifyTaskMoveCollapse,
  mergeStatusFlipActivity,
} = jiti(
  path.join(root, "src/utils/controllers/activities/taskMoveCollapse.ts"),
);
const { sendTaskMoveNotificationIfNeeded } = jiti(
  path.join(root, "src/utils/controllers/activities/sendTaskMoveNotification.ts"),
);

const NOW = 2_000_000_000;
const move = (
  fromId,
  toId,
  { userId = 6, agent = null, currentSectionId, statusFlipCount, quickMoveCollapsed } = {},
) => ({
  type: "TaskMove",
  data: {
    fromUserId: userId,
    fromAgent: agent,
    fromSection: { sectionId: fromId, sectionTitle: `Section ${fromId}` },
    toSection: { sectionId: toId, sectionTitle: `Section ${toId}` },
    ...(currentSectionId
      ? {
          currentSection: {
            sectionId: currentSectionId,
            sectionTitle: `Section ${currentSectionId}`,
          },
        }
      : {}),
    ...(statusFlipCount ? { statusFlipCount } : {}),
    ...(quickMoveCollapsed ? { quickMoveCollapsed } : {}),
  },
});

const classify = ({
  previousActivity = move(1, 2),
  age = 5_000,
  sameActor = true,
  fromSectionId = 2,
  toSectionId = 1,
} = {}) =>
  classifyTaskMoveCollapse({
    previousActivity,
    previousCreatedAt: new Date(NOW - age),
    sameActor,
    fromSectionId,
    toSectionId,
    now: NOW,
  });

test("a same-actor A-B reversal within 30 minutes collapses", () => {
  assert.equal(
    classify({ age: STATUS_FLIP_COLLAPSE_WINDOW_MS }),
    "status-flip",
  );
});

test("a repeated A-B run follows its stored current section", () => {
  const previousActivity = move(1, 2, {
    currentSectionId: 1,
    statusFlipCount: 1,
  });
  assert.equal(
    classify({ previousActivity, fromSectionId: 1, toSectionId: 2 }),
    "status-flip",
  );
});

test("a flip outside the window remains a separate activity", () => {
  assert.equal(
    classify({ age: STATUS_FLIP_COLLAPSE_WINDOW_MS + 1 }),
    null,
  );
});

test("another actor's reversal remains a separate activity", () => {
  assert.equal(classify({ sameActor: false }), null);
});

test("a move involving a third section is not treated as A-B ping-pong", () => {
  assert.equal(
    classify({ age: 5 * 60_000, fromSectionId: 2, toSectionId: 3 }),
    null,
  );
});

test("the existing rapid multi-column journey collapse remains intact", () => {
  assert.equal(
    classify({ age: 5_000, fromSectionId: 2, toSectionId: 3 }),
    "quick-journey",
  );
});

test("a non-move activity blocks collapsing", () => {
  assert.equal(
    classify({ previousActivity: { type: "TaskAssigned", data: {} } }),
    null,
  );
});

test("merging a flip preserves the section pair and records the latest destination", () => {
  const firstFlip = mergeStatusFlipActivity(move(1, 2), {
    sectionId: 1,
    sectionTitle: "Section 1",
  });
  const secondFlip = mergeStatusFlipActivity(firstFlip, {
    sectionId: 2,
    sectionTitle: "Section 2",
  });

  assert.equal(secondFlip.data.fromSection.sectionId, 1);
  assert.equal(secondFlip.data.toSection.sectionId, 2);
  assert.equal(secondFlip.data.currentSection.sectionId, 2);
  assert.equal(secondFlip.data.statusFlipCount, 2);
});

test("a collapsed run does not invoke notification delivery", async () => {
  let deliveries = 0;
  const sent = await sendTaskMoveNotificationIfNeeded(
    { shouldNotify: false },
    async () => {
      deliveries += 1;
    },
  );

  assert.equal(sent, false);
  assert.equal(deliveries, 0);
});

test("the first move awaits one notification delivery", async () => {
  let delivered = false;
  const sent = await sendTaskMoveNotificationIfNeeded(
    { shouldNotify: true },
    async () => {
      await Promise.resolve();
      delivered = true;
    },
  );

  assert.equal(sent, true);
  assert.equal(delivered, true);
});

test("notification failures do not turn a successful move into a failed request", async () => {
  const failure = new Error("notification unavailable");
  let reported;
  const sent = await sendTaskMoveNotificationIfNeeded(
    { shouldNotify: true },
    async () => {
      throw failure;
    },
    (error) => {
      reported = error;
    },
  );

  assert.equal(sent, false);
  assert.equal(reported, failure);
});
