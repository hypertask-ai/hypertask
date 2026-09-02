const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const modulePath = (relativePath) => path.join(root, relativePath);
const stubModule = (relativePath, exports) => {
  const filename = modulePath(relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

function loadService(storedComment) {
  const calls = {
    lookup: [],
    transactions: 0,
    commentUpdates: [],
    attachmentDeletes: [],
    attachmentCreates: [],
    invalidations: [],
  };
  const existingAttachments = [
    { id: 10, fileSource: "https://files.test/keep.png" },
    { id: 11, fileSource: "https://files.test/remove.png" },
  ];
  const tx = {
    attachment: {
      findMany: async () => existingAttachments,
      deleteMany: async (args) => calls.attachmentDeletes.push(args),
      createMany: async (args) => calls.attachmentCreates.push(args),
    },
    comment: {
      update: async (args) => {
        calls.commentUpdates.push(args);
        return {
          id: 44,
          taskId: 91,
          text: args.data.text,
          seen: [6],
          attachments: [],
        };
      },
    },
  };
  const prisma = {
    comment: {
      findFirst: async (args) => {
        calls.lookup.push(args);
        return storedComment;
      },
    },
    $transaction: async (run) => {
      calls.transactions += 1;
      return run(tx);
    },
  };

  for (const relativePath of [
    "src/utils/controllers/comments/updateCommentService.ts",
    "src/lib/prisma.ts",
    "src/utils/controllers/turbopuffer/turbopufferHelper.ts",
    "src/pages/api/queues/FAST/generateSummary.ts",
    "src/pages/api/queues/FAST/generateCommentSummary.ts",
    "src/utils/controllers/comments/processMentions.ts",
    "src/utils/controllers/comments/readReceipts.ts",
    "src/lib/ai/hyperAiConfirmation.ts",
  ]) {
    delete require.cache[modulePath(relativePath)];
  }

  stubModule("src/lib/prisma.ts", { default: prisma });
  stubModule("src/utils/controllers/turbopuffer/turbopufferHelper.ts", {
    upsertCommentToTurbopuffer: () => {},
  });
  stubModule("src/pages/api/queues/FAST/generateSummary.ts", {
    default: async () => {},
  });
  stubModule("src/pages/api/queues/FAST/generateCommentSummary.ts", {
    default: async () => {},
  });
  stubModule("src/utils/controllers/comments/processMentions.ts", {
    processMentionsFromCommentText: async () => {},
  });
  stubModule("src/utils/controllers/comments/readReceipts.ts", {
    omitCommentSeen: ({ seen: _seen, ...comment }) => comment,
  });
  stubModule("src/lib/ai/hyperAiConfirmation.ts", {
    invalidateHyperAiCommentOrigin: async (commentId) =>
      calls.invalidations.push(commentId),
  });

  const jiti = require("jiti")(
    path.join(root, `tests/update-comment-ownership-${Date.now()}-${Math.random()}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
      cache: false,
    },
  );
  const loaded = jiti(modulePath("src/utils/controllers/comments/updateCommentService.ts"));
  return { updateCommentService: loaded.updateCommentService, calls };
}

test("a user cannot update a comment they do not own", async () => {
  const { updateCommentService, calls } = loadService(null);

  await assert.rejects(
    updateCommentService({ commentId: 44, text: "changed", userId: 6 }),
    /not owned by user/,
  );
  assert.deepEqual(calls.lookup[0].where, { id: 44, creatorId: 6 });
  assert.equal(calls.transactions, 0);
  assert.deepEqual(calls.invalidations, []);
});

test("an owner updates text and attachments in one transaction", async () => {
  const { updateCommentService, calls } = loadService({
    id: 44,
    taskId: 91,
    task: { projectId: 15 },
  });

  const updated = await updateCommentService({
    commentId: 44,
    text: "<p>line one</p><ul><li>line two</li></ul>",
    userId: 6,
    attachments: [
      {
        fileType: "image/png",
        fileSource: "https://files.test/keep.png",
        fileName: "keep.png",
        fileSize: "12",
      },
      {
        id: 999,
        taskId: 999,
        commentId: 999,
        fileType: "application/pdf",
        fileSource: "https://files.test/new.pdf",
        fileName: "new.pdf",
        fileSize: "34",
      },
      {
        fileType: "application/pdf",
        fileSource: "https://files.test/new.pdf",
        fileName: "duplicate-new.pdf",
        fileSize: "34",
      },
    ],
  });

  assert.equal(calls.transactions, 1);
  assert.deepEqual(calls.invalidations, [44]);
  assert.deepEqual(calls.attachmentDeletes[0], { where: { id: { in: [11] } } });
  assert.equal(calls.attachmentCreates[0].data.length, 1);
  assert.equal(calls.attachmentCreates[0].data[0].fileSource, "https://files.test/new.pdf");
  assert.equal(calls.attachmentCreates[0].data[0].taskId, 91);
  assert.equal(calls.attachmentCreates[0].data[0].commentId, 44);
  assert.equal(calls.attachmentCreates[0].data[0].id, undefined);
  assert.equal(calls.commentUpdates[0].data.text, "<p>line one</p><ul><li>line two</li></ul>");
  assert.equal("seen" in updated, false);
});
