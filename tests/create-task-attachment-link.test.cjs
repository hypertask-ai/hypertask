const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let loadId = 0;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

function loadLinker({
  authorized = true,
  storageAvailable = true,
  storageError,
  deleteFails = false,
} = {}) {
  const events = [];
  const rows = [];
  const rawQueries = [];
  const deleted = [];
  let creates = 0;
  let accessWhere;
  const tx = {
    $queryRaw: async (query) => {
      rawQueries.push(query);
      const sql = query.strings.join("?");
      events.push(sql.includes("pg_advisory_xact_lock") ? "receipt-lock" : "task-lock");
      return [{ id: 99 }];
    },
    task: {
      findFirst: async ({ where }) => {
        events.push("authorize");
        accessWhere = where;
        return authorized ? { id: 99, description_: { id: "description-99" } } : null;
      },
    },
    attachment: {
      findFirst: async ({ where }) => {
        events.push("find-attachment");
        return rows.find((row) =>
          Object.entries(where).every(([key, value]) => row[key] === value)
        ) ?? null;
      },
      create: async ({ data }) => {
        events.push("create-attachment");
        creates += 1;
        const row = {
          id: creates,
          createdAt: new Date(),
          commentId: null,
          descriptionId: null,
          taskId: null,
          ...data,
        };
        rows.push(row);
        return row;
      },
      findFirstOrThrow: async ({ where }) => {
        events.push("return-attachment");
        const row = rows.find(
          (candidate) =>
            candidate.taskId === where.taskId &&
            candidate.descriptionId === where.descriptionId &&
            candidate.commentId === where.commentId &&
            candidate.fileSource === where.fileSource,
        );
        if (!row) throw new Error("attachment not found");
        return row;
      },
    },
  };
  const prisma = {
    $transaction: async (operation) => operation(tx),
  };

  const linkerPath = path.join(root, "src/lib/storage/linkTaskAttachment.ts");
  delete require.cache[linkerPath];
  delete require.cache[path.join(root, "src/lib/prisma.ts")];
  delete require.cache[path.join(
    root,
    "src/utils/controllers/projects/getAllIncludes.ts",
  )];
  delete require.cache[path.join(root, "src/lib/storage/hypertasksS3.ts")];
  delete require.cache[path.join(
    root,
    "src/lib/storage/uploadTaskAttachmentToS3.ts",
  )];
  stubModule("src/lib/prisma.ts", { default: prisma });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    taskWriteAccessWhere: (userId) => ({ writer: userId }),
  });
  stubModule("src/lib/storage/hypertasksS3.ts", {
    getHypertasksS3Client: () => ({
      headObject: () => ({
        promise: async () => {
          if (storageError) throw storageError;
          if (!storageAvailable) {
            throw Object.assign(new Error("object missing"), {
              code: "NotFound",
              statusCode: 404,
            });
          }
        },
      }),
      deleteObject: ({ Key }) => ({
        promise: async () => {
          if (deleteFails) throw new Error("delete failed");
          deleted.push(Key);
        },
      }),
    }),
    getHypertasksStoragePublicUrl: (key) => `https://files.example/${key}`,
    HYPERTASKS_S3_BUCKET: "test-bucket",
  });
  stubModule("src/lib/storage/uploadTaskAttachmentToS3.ts", {
    TASK_ATTACHMENT_PREFIX: "tasks/attachments",
  });

  const jiti = require("jiti")(
    path.join(root, `tests/create-task-attachment-link-${++loadId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
      cache: false,
    },
  );
  return {
    ...jiti(linkerPath),
    events,
    rows,
    rawQueries,
    deleted,
    get creates() {
      return creates;
    },
    get accessWhere() {
      return accessWhere;
    },
  };
}

const receipt = {
  userId: 6,
  key: "tasks/attachments/receipt-file.txt",
  fileName: "receipt-file.txt",
  contentType: "text/plain",
  fileSize: 42,
};

test("linking locks the task, rechecks write access, and persists trusted metadata", async () => {
  const linker = loadLinker();
  const linked = await linker.linkTaskAttachment(99, 6, receipt);

  assert.deepEqual(linker.events.slice(0, 3), [
    "receipt-lock",
    "task-lock",
    "authorize",
  ]);
  assert.ok(
    linker.rawQueries.some(
      (query) =>
        /pg_advisory_xact_lock/.test(query.strings.join("?")) &&
        query.values.includes(receipt.key),
    ),
  );
  assert.ok(
    linker.rawQueries.some(
      (query) =>
        /FROM "Task"[\s\S]*FOR UPDATE/.test(query.strings.join("?")) &&
        query.values.includes(99),
    ),
  );
  assert.deepEqual(linker.accessWhere, { id: 99, project: { writer: 6 } });
  assert.equal(linker.creates, 1);
  assert.equal(linked.fileName, "receipt-file.txt");
  assert.equal(linked.fileType, "text/plain");
  assert.equal(linked.fileSize, "42");
  assert.equal(
    linked.fileSource,
    "https://files.example/tasks/attachments/receipt-file.txt",
  );
});

test("a retry after a lost response returns the existing attachment", async () => {
  const linker = loadLinker();

  const first = await linker.linkTaskAttachment(99, 6, receipt);
  const retried = await linker.linkTaskAttachment(99, 6, receipt);

  assert.equal(linker.creates, 1);
  assert.equal(retried.id, first.id);
  assert.equal(
    linker.events.filter((event) => event === "task-lock").length,
    2,
  );
});

test("a receipt cannot be replayed onto a second task", async () => {
  const linker = loadLinker();
  await linker.linkTaskAttachment(99, 6, receipt);

  await assert.rejects(
    linker.linkTaskAttachment(100, 6, receipt),
    (error) => error.name === "TaskAttachmentLinkError" && error.status === 409,
  );
  assert.equal(linker.creates, 1);
});

test("linking refuses an inaccessible task before attachment persistence", async () => {
  const linker = loadLinker({ authorized: false });

  await assert.rejects(
    linker.linkTaskAttachment(99, 6, receipt),
    (error) => error.name === "TaskAttachmentLinkError" && error.status === 404,
  );
  assert.equal(linker.creates, 0);
  assert.deepEqual(linker.events, ["receipt-lock", "task-lock", "authorize"]);
});

test("linking rejects a receipt issued to another user", async () => {
  const linker = loadLinker();

  await assert.rejects(
    linker.linkTaskAttachment(99, 7, receipt),
    (error) => error.name === "TaskAttachmentLinkError" && error.status === 403,
  );
  assert.deepEqual(linker.events, []);
});

test("linking rejects a receipt key outside task attachment storage", async () => {
  const linker = loadLinker();

  await assert.rejects(
    linker.linkTaskAttachment(99, 6, {
      ...receipt,
      key: "tasks/attachments/../../private.txt",
    }),
    (error) => error.name === "TaskAttachmentLinkError" && error.status === 400,
  );
  assert.deepEqual(linker.events, []);
});

test("linking rejects an upload that cancellation already removed", async () => {
  const linker = loadLinker({ storageAvailable: false });

  await assert.rejects(
    linker.linkTaskAttachment(99, 6, receipt),
    (error) => error.name === "TaskAttachmentLinkError" && error.status === 409,
  );
  assert.equal(linker.creates, 0);
});

test("linking surfaces transient storage failures for retry", async () => {
  const storageError = Object.assign(new Error("storage unavailable"), {
    code: "ServiceUnavailable",
    statusCode: 503,
  });
  const linker = loadLinker({ storageError });

  await assert.rejects(
    linker.linkTaskAttachment(99, 6, receipt),
    (error) => error === storageError,
  );
  assert.equal(linker.creates, 0);
});

test("discard shares the receipt lock and preserves linked objects", async () => {
  const unlinked = loadLinker();
  assert.equal(await unlinked.discardTaskAttachment(6, receipt), true);
  assert.deepEqual(unlinked.deleted, [receipt.key]);
  assert.match(
    unlinked.rawQueries[0].strings.join("?"),
    /pg_advisory_xact_lock/,
  );
  assert.ok(unlinked.rawQueries[0].values.includes(receipt.key));

  const linked = loadLinker();
  await linked.linkTaskAttachment(99, 6, receipt);
  assert.equal(await linked.discardTaskAttachment(6, receipt), false);
  assert.deepEqual(linked.deleted, []);
});

test("discard surfaces storage deletion failures for retry", async () => {
  const linker = loadLinker({ deleteFails: true });

  await assert.rejects(
    linker.discardTaskAttachment(6, receipt),
    (error) => error.name === "TaskAttachmentLinkError" && error.status === 502,
  );
});
