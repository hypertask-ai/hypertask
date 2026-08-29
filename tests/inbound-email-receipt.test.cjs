const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(root, "tests/inbound-email-receipt-jiti.cjs"),
  {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
    cache: false,
  },
);
const {
  InboundEmailProcessingInProgressError,
  claimInboundEmailProcessing,
  completeInboundEmailProcessing,
  findInboundEmailReceipt,
  recordInboundEmailComment,
  releaseInboundEmailProcessing,
} = jiti(
  path.join(root, "src/utils/controllers/comments/inboundEmailReceipt.ts"),
);

function receiptClient(initialReceipt = null) {
  let receipt = initialReceipt;
  const calls = { finds: [], creates: [], updates: [] };
  const client = {
    inboundEmailReceipt: {
      findUnique: async (query) => {
        calls.finds.push(query);
        return receipt;
      },
      create: async ({ data }) => {
        calls.creates.push(data);
        receipt = {
          ...data,
          processingStartedAt: data.processingStartedAt,
          completedAt: null,
          comment: { id: data.commentId, taskId: data.taskId },
        };
      },
      updateMany: async ({ where, data }) => {
        calls.updates.push({ where, data });
        if (
          !receipt ||
          receipt.emailId !== where.emailId ||
          receipt.commentId !== where.commentId ||
          receipt.completedAt !== null ||
          (where.processingStartedAt &&
            receipt.processingStartedAt !== where.processingStartedAt)
        ) {
          return { count: 0 };
        }
        if (where.OR) {
          const staleBefore = where.OR[1].processingStartedAt.lt;
          const canClaim =
            receipt.processingStartedAt === null ||
            receipt.processingStartedAt < staleBefore;
          if (!canClaim) return { count: 0 };
        }
        receipt = { ...receipt, ...data };
        return { count: 1 };
      },
    },
  };
  return { client, calls, getReceipt: () => receipt };
}

test("a received email id resolves only the comment created for its task", async () => {
  const stored = {
    emailId: "email-1",
    taskId: 99,
    commentId: 41,
    processingStartedAt: null,
    completedAt: null,
    comment: { id: 41, taskId: 99 },
  };
  const { client, calls } = receiptClient(stored);

  assert.deepEqual(
    await findInboundEmailReceipt(client, "email-1", 99),
    stored,
  );
  assert.deepEqual(calls.finds[0], {
    where: { emailId: "email-1" },
    include: { comment: true },
  });
  await assert.rejects(
    findInboundEmailReceipt(client, "email-1", 100),
    /belongs to another task/,
  );
});

test("a deleted comment keeps its completed receipt bound to the task", async () => {
  const stored = {
    emailId: "email-deleted",
    taskId: 99,
    commentId: null,
    processingStartedAt: null,
    completedAt: new Date("2026-08-23T09:05:00.000Z"),
    comment: null,
  };
  const { client } = receiptClient(stored);

  assert.deepEqual(
    await findInboundEmailReceipt(client, "email-deleted", 99),
    stored,
  );
  await assert.rejects(
    findInboundEmailReceipt(client, "email-deleted", 100),
    /belongs to another task/,
  );
});

test("recording a receipt starts one resumable processing lease", async () => {
  const { client, calls } = receiptClient();
  const startedAt = new Date("2026-08-23T09:00:00.000Z");

  await recordInboundEmailComment(client, "email-2", 99, 42, startedAt);
  assert.deepEqual(calls.creates, [
    {
      emailId: "email-2",
      taskId: 99,
      commentId: 42,
      processingStartedAt: startedAt,
    },
  ]);
});

test("a fresh lease blocks concurrent delivery and a failed run can resume", async () => {
  const firstStart = new Date("2026-08-23T09:00:00.000Z");
  const retryStart = new Date("2026-08-23T09:01:00.000Z");
  const { client, getReceipt } = receiptClient({
    emailId: "email-3",
    commentId: 43,
    processingStartedAt: firstStart,
    completedAt: null,
    comment: { id: 43, taskId: 99 },
  });

  await assert.rejects(
    claimInboundEmailProcessing(
      client,
      "email-3",
      43,
      retryStart,
      new Date("2026-08-23T08:56:00.000Z"),
    ),
    InboundEmailProcessingInProgressError,
  );

  await releaseInboundEmailProcessing(client, "email-3", 43, firstStart);
  await claimInboundEmailProcessing(
    client,
    "email-3",
    43,
    retryStart,
    new Date("2026-08-23T08:56:00.000Z"),
  );
  assert.equal(getReceipt().processingStartedAt, retryStart);

  await releaseInboundEmailProcessing(client, "email-3", 43, firstStart);
  assert.equal(getReceipt().processingStartedAt, retryStart);

  await completeInboundEmailProcessing(client, "email-3", 43, retryStart);
  assert.equal(getReceipt().processingStartedAt, null);
  assert.ok(getReceipt().completedAt instanceof Date);
});

test("an abandoned lease becomes claimable after its timeout", async () => {
  const retryStart = new Date("2026-08-23T09:10:00.000Z");
  const { client, getReceipt } = receiptClient({
    emailId: "email-4",
    commentId: 44,
    processingStartedAt: new Date("2026-08-23T09:00:00.000Z"),
    completedAt: null,
    comment: { id: 44, taskId: 99 },
  });

  await claimInboundEmailProcessing(
    client,
    "email-4",
    44,
    retryStart,
    new Date("2026-08-23T09:05:00.000Z"),
  );
  assert.equal(getReceipt().processingStartedAt, retryStart);
});
