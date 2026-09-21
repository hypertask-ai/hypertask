const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  moduleCache: false,
  alias: { "@": path.join(root, "src") },
});

const { TaskService } = jiti(
  path.join(root, "src/lib/mcp-server/lib/services/task.service.ts")
);
const { CommentService } = jiti(
  path.join(root, "src/lib/mcp-server/lib/services/comment.service.ts")
);
const {
  CreateTaskInputSchema,
  UpdateTaskInputSchema,
} = jiti(path.join(root, "src/lib/mcp-server/validations/task.validation.ts"));
const { validateAndSanitizeAddCommentCrudInput } = jiti(
  path.join(root, "src/lib/mcp-server/validations/comment.validation.ts")
);
const { parseAndValidateAttachmentsBody } = jiti(
  path.join(root, "src/lib/mcp/attachments/validateBody.ts")
);
const { MCP_ATTACHMENT_MAX_BASE64_CHARACTERS } = jiti(
  path.join(root, "src/lib/mcp/attachments/validateBody.ts")
);
const { AttachFilesInputSchema } = jiti(
  path.join(root, "src/lib/mcp-server/validations/attachment.validation.ts")
);
const { AttachmentBatchError, storeAttachmentBatch } = jiti(
  path.join(root, "src/lib/mcp/attachments/storeBatch.ts")
);
const { storeAttachmentBatchWithTargetLock } = jiti(
  path.join(root, "src/lib/mcp/attachments/storeLockedBatch.ts")
);
const { persistAttachmentRows } = jiti(
  path.join(root, "src/lib/mcp/attachments/persistBatch.ts")
);
const {
  buildTaskAttachmentStorageKey,
  isDeterministicTaskAttachmentForTarget,
} = jiti(
  path.join(root, "src/lib/storage/uploadTaskAttachmentToS3.ts")
);
const { ApiError } = jiti(
  path.join(root, "src/lib/mcp-server/utils/errors.ts")
);
const { idempotencyKeyForInvocation } = jiti(
  path.join(root, "src/lib/mcp-server/utils/invocation-idempotency.ts")
);
const { readBodyWithCap, safeFetchAttachmentUrl } = jiti(
  path.join(root, "src/lib/mcp/attachments/safeFetch.ts")
);
const { readMcpAttachmentJsonBody } = jiti(
  path.join(root, "src/lib/mcp/attachments/readRequestBody.ts")
);
const { MCP_ATTACHMENT_MAX_REQUEST_BYTES } = jiti(
  path.join(root, "src/lib/mcp/attachments/constants.ts")
);

const FILE = {
  filename: "evidence.png",
  content_type: "image/png",
  data: "iVBORw0KGgo=",
};

function distinctPngFile(filename, marker) {
  return {
    ...FILE,
    filename,
    data: Buffer.concat([
      Buffer.from(FILE.data, "base64"),
      Buffer.from([marker]),
    ]).toString("base64"),
  };
}

function task(id, ticketNumber) {
  return {
    id,
    ticketNumber,
    projectId: 15,
  };
}

function recordingClient(handler) {
  const requests = [];
  return {
    requests,
    async makeRequest(url, options, correlationId, requestOptions) {
      const request = {
        url,
        options,
        body: options?.body ? JSON.parse(options.body) : undefined,
        correlationId,
        requestOptions,
      };
      requests.push(request);
      return handler(request);
    },
  };
}

test("create_task accepts inline attachments and returns their public URLs", async () => {
  const client = recordingClient(({ url }) => {
    if (url === "/mcp/tasks/create") {
      return { success: true, task: task(41, "HTPR-41") };
    }
    if (url === "/mcp/tasks/attachments") {
      return {
        success: true,
        attachments: [
          {
            id: 9,
            fileName: FILE.filename,
            fileType: FILE.content_type,
            fileSize: 8,
            url: "https://files.hypertask.app/tasks/attachments/evidence.png",
          },
        ],
      };
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await new TaskService(client).createTask(
    {
      project_id: 15,
      title: "Task with evidence",
      attachments: [FILE],
    },
    { requestId: "create-41", clientFingerprint: "token-a" }
  );

  assert.equal(result.success, true);
  assert.equal(result.task.id, 41);
  assert.equal(
    result.attachments[0].url,
    "https://files.hypertask.app/tasks/attachments/evidence.png"
  );
  assert.deepEqual(client.requests.map(({ url }) => url), [
    "/mcp/tasks/create",
    "/mcp/tasks/attachments",
  ]);
  assert.equal(client.requests[0].body.attachments, undefined);
  assert.match(
    client.requests[0].options.headers["Idempotency-Key"],
    /^mcp-invocation-[a-f0-9]{64}$/
  );
  assert.deepEqual(client.requests[1].body, {
    task_id: 41,
    files: [FILE],
  });
  assert.equal(client.requests[1].requestOptions.timeoutMs, 660000);
});

test("update_task permits an attachment-only update", async () => {
  const client = recordingClient(({ url }) => {
    if (url === "/mcp/tasks?ticket_number=HTPR-42") {
      return { success: true, tasks: [task(42, "HTPR-42")] };
    }
    if (url === "/mcp/tasks/attachments") {
      return {
        success: true,
        attachments: [{
          id: 11,
          fileName: FILE.filename,
          fileType: FILE.content_type,
          fileSize: 8,
          url: "https://files.hypertask.app/tasks/attachments/update.png",
        }],
      };
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await new TaskService(client).updateTask({
    ticket_number: "HTPR-42",
    attachments: [FILE],
  });

  assert.equal(result.success, true);
  assert.equal(client.requests[0].url, "/mcp/tasks?ticket_number=HTPR-42");
  assert.equal(client.requests[0].options.method, "GET");
  assert.deepEqual(client.requests[1].body, {
    task_id: 42,
    files: [FILE],
  });
});

test("an attachment-only update returns a usable failed result", async () => {
  const client = recordingClient(({ url }) => {
    if (url === "/mcp/tasks?ticket_number=HTPR-43") {
      return { success: true, tasks: [task(43, "HTPR-43")] };
    }
    if (url === "/mcp/tasks/attachments") {
      return { success: true, attachments: [] };
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await new TaskService(client).updateTask({
    ticket_number: "HTPR-43",
    attachments: [FILE],
  });
  assert.equal(result.success, false);
  assert.equal(result.attachment_status, "failed");
  assert.match(result.attachment_error, /Stored 0 of 1 requested attachment/);
  assert.deepEqual(result.attachments, []);
  assert.equal(
    client.requests.some(({ url }) => url === "/mcp/tasks/update"),
    false
  );
});

test("an attachment-only update returns task context after a transport error", async () => {
  const client = recordingClient(({ url }) => {
    if (url === "/mcp/tasks?ticket_number=HTPR-430") {
      return { success: true, tasks: [task(430, "HTPR-430")] };
    }
    if (url === "/mcp/tasks/attachments") {
      throw new Error("attachment request timed out");
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await new TaskService(client).updateTask({
    ticket_number: "HTPR-430",
    attachments: [FILE],
  });

  assert.equal(result.success, false);
  assert.equal(result.task.id, 430);
  assert.equal(result.attachment_status, "failed");
  assert.match(result.attachment_error, /timed out/);
  assert.deepEqual(result.attachments, []);
  assert.match(result.message, /do not repeat the original operation/);
});

test("add_comment attaches files to the comment returned by the mutation", async () => {
  const client = recordingClient(({ url }) => {
    if (url === "/mcp/comments") {
      return {
        success: true,
        comment: {
          id: 73,
          text: "<p>Evidence</p>",
          createdAt: "2026-08-08T00:00:00.000Z",
        },
      };
    }
    if (url === "/mcp/tasks/attachments") {
      return {
        success: true,
        attachments: [
          {
            id: 10,
            fileName: FILE.filename,
            fileType: FILE.content_type,
            fileSize: 8,
            url: "https://files.hypertask.app/tasks/attachments/comment.png",
          },
        ],
      };
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await new CommentService(client).addComment(
    {
      ticket_number: "HTPR-3099",
      text: "<p>Evidence</p>",
      attachments: [FILE],
    },
    { requestId: "comment-73", clientFingerprint: "token-a" }
  );

  assert.equal(result.success, true);
  assert.equal(result.comment.id, 73);
  assert.equal(client.requests[0].body.attachments, undefined);
  assert.match(
    client.requests[0].options.headers["Idempotency-Key"],
    /^mcp-invocation-[a-f0-9]{64}$/
  );
  assert.deepEqual(client.requests[1].body, {
    ticket_number: "HTPR-3099",
    comment_id: 73,
    files: [FILE],
  });
});

test("a post-create upload failure reports partial success without inviting duplicates", async () => {
  const client = recordingClient(({ url }) => {
    if (url === "/mcp/tasks/create") {
      return { success: true, task: task(44, "HTPR-44") };
    }
    if (url === "/mcp/tasks/attachments") {
      throw new Error("upload unavailable");
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await new TaskService(client).createTask({
    project_id: 15,
    title: "Created before upload",
    attachments: [FILE],
  });

  assert.equal(result.success, true);
  assert.equal(result.task.id, 44);
  assert.equal(result.attachment_status, "failed");
  assert.equal(result.attachment_error, "upload unavailable");
  assert.match(result.message, /do not repeat the original operation/i);
  assert.match(result.message, /hypertask_attach_files/);
});

test("an attachment error response may omit the attachments array", async () => {
  const client = recordingClient(({ url }) => {
    if (url === "/mcp/tasks/update") {
      return { success: true, task: task(46, "HTPR-46") };
    }
    if (url === "/mcp/tasks/attachments") {
      return { success: false, error: "upload rejected" };
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await new TaskService(client).updateTask(
    {
      ticket_number: "HTPR-46",
      title: "Updated before upload",
      attachments: [FILE],
    },
    { requestId: "update-46", clientFingerprint: "token-a" }
  );

  assert.equal(result.success, true);
  assert.deepEqual(result.attachments, []);
  assert.equal(result.attachment_status, "failed");
  assert.equal(result.attachment_error, "upload rejected");
  assert.match(
    client.requests[0].options.headers["Idempotency-Key"],
    /^mcp-invocation-[a-f0-9]{64}$/
  );
});

test("the attachment endpoint accepts and forwards project_id + unique_index", () => {
  const parsed = parseAndValidateAttachmentsBody({
    project_id: 15,
    unique_index: 3099,
    comment_id: 73,
    files: [FILE],
  });
  assert.equal(parsed.project_id, 15);
  assert.equal(parsed.unique_index, 3099);

  const route = fs.readFileSync(
    path.join(root, "src/app/api/mcp/tasks/attachments/route.ts"),
    "utf8"
  );
  assert.match(route, /unique_index: parsed\.unique_index \?\? null/);
  assert.match(route, /project_id: parsed\.project_id \?\? null/);
});

test("the attachment endpoint delegates persistence to the atomic batch path", () => {
  const route = fs.readFileSync(
    path.join(root, "src/app/api/mcp/tasks/attachments/route.ts"),
    "utf8"
  );
  assert.match(route, /storeAttachmentBatchWithTargetLock\(/);
  assert.match(route, /readMcpAttachmentJsonBody\(request\)/);
  assert.doesNotMatch(route, /body\s*=\s*await request\.json\(\)/);
  assert.doesNotMatch(route, /status: 207/);
});

test("the attachment HTTP body is bounded before JSON parsing", async () => {
  await assert.rejects(
    () =>
      readMcpAttachmentJsonBody({
        headers: new Headers({
          "content-length": String(MCP_ATTACHMENT_MAX_REQUEST_BYTES + 1),
        }),
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("{}"));
            controller.close();
          },
        }),
      }),
    (error) => error?.status === 413
  );

  await assert.rejects(
    () =>
      readMcpAttachmentJsonBody({
        headers: new Headers(),
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new Uint8Array(MCP_ATTACHMENT_MAX_REQUEST_BYTES + 1)
            );
            controller.close();
          },
        }),
      }),
    (error) => error?.status === 413
  );

  assert.deepEqual(
    await readMcpAttachmentJsonBody({
      headers: new Headers(),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"task_id":1}'));
          controller.close();
        },
      }),
    }),
    { task_id: 1 }
  );
});

test("the attachment endpoint requires write scope for managed agents", () => {
  const route = fs.readFileSync(
    path.join(root, "src/app/api/mcp/tasks/attachments/route.ts"),
    "utf8"
  );
  assert.match(route, /if \(ctx\.agentId\)/);
  assert.match(route, /requireRole\(ctx, ['"]write['"]\)/);
  assert.match(route, /if \(scopeError\) return scopeError/);

  const createRoute = fs.readFileSync(
    path.join(root, "src/app/api/mcp/tasks/create/route.ts"),
    "utf8"
  );
  assert.match(createRoute, /requireRole\(ctx, ['"]write['"]\)/);

  const commentsRoute = fs.readFileSync(
    path.join(root, "src/app/api/mcp/comments/route.ts"),
    "utf8"
  );
  const commentPost = commentsRoute.slice(commentsRoute.indexOf("export async function POST"));
  assert.match(commentPost, /requireRole\(ctx, ['"]write['"]\)/);
});

test("inline mutations preserve cleanup uncertainty from attachment failures", async () => {
  const retryNote = "Cleanup could not be confirmed; retrying reuses the same key.";
  const client = recordingClient(({ url }) => {
    if (url === "/mcp/tasks/create") {
      return { success: true, task: task(45, "HTPR-45") };
    }
    if (url === "/mcp/tasks/attachments") {
      throw new ApiError("Failed to store attachment(s)", 500, {
        success: false,
        error: "Failed to store attachment(s)",
        cleanup_confirmed: false,
        retry_note: retryNote,
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await new TaskService(client).createTask({
    project_id: 15,
    title: "Created before uncertain cleanup",
    attachments: [FILE],
  });

  assert.equal(result.success, true);
  assert.equal(result.cleanup_confirmed, false);
  assert.equal(result.retry_note, retryNote);
});

test("partial attachment responses preserve cleanup uncertainty", async () => {
  const retryNote = "Inspect the retained deterministic object before retrying.";
  const client = recordingClient(({ url }) => {
    if (url === "/mcp/tasks/create") {
      return { success: true, task: task(47, "HTPR-47") };
    }
    if (url === "/mcp/tasks/attachments") {
      return {
        success: false,
        attachments: [{
          id: 81,
          fileName: FILE.filename,
          fileType: FILE.content_type,
          fileSize: 8,
        }],
        attachment_status: "partial",
        failed_files: [{ index: 1, filename: "second.png", error: "upload timed out" }],
        error: "Stored 1 of 2 attachments",
        cleanup_confirmed: false,
        retry_note: retryNote,
      };
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await new TaskService(client).createTask({
    project_id: 15,
    title: "Created with a partial attachment batch",
    attachments: [FILE, distinctPngFile("second.png", 1)],
  });

  assert.equal(result.attachment_status, "partial");
  assert.equal(result.cleanup_confirmed, false);
  assert.equal(result.retry_note, retryNote);
});

test("an unknown S3 outcome persists a durable deterministic identity", async () => {
  const deleted = [];
  let persistCalled = false;

  await assert.rejects(
    () =>
      storeAttachmentBatch(
        [parseAndValidateAttachmentsBody({ task_id: 1, files: [FILE] }).files[0]],
        { taskId: 1, targetKey: "description-abc" },
        async (uploads) => {
          persistCalled = true;
          return uploads.map((upload, index) => ({
            id: index + 1,
            fileName: upload.filename,
            fileType: upload.contentType,
            fileSource: upload.url,
          }));
        },
        {
          buildKey: () => "tasks/attachments/stable-key",
          objectState: async () => "unknown",
          upload: async () => {
            throw new Error("response lost after commit");
          },
          deleteObject: async (key) => {
            deleted.push(key);
            return true;
          },
        }
      ),
    (error) =>
      error instanceof AttachmentBatchError &&
      error.cleanupConfirmed === false &&
      error.status === 500 &&
      error.attachments.length === 1
  );

  assert.equal(persistCalled, true);
  assert.deepEqual(deleted, []);
});

test("lock loss before upload cannot persist a phantom attachment", async () => {
  let uploadCalled = false;
  let objectStateCalled = false;
  let persistCalled = false;

  await assert.rejects(
    () =>
      storeAttachmentBatch(
        parseAndValidateAttachmentsBody({ task_id: 1, files: [FILE] }).files,
        { taskId: 1, targetKey: "description-abc" },
        async () => {
          persistCalled = true;
          return [];
        },
        {
          assertOwnership: () => {
            throw new Error("lock lost before upload");
          },
          objectState: async () => {
            objectStateCalled = true;
            return "unknown";
          },
          upload: async () => {
            uploadCalled = true;
            return "unexpected";
          },
        }
      ),
    (error) =>
      error instanceof AttachmentBatchError &&
      error.cleanupConfirmed === false &&
      error.attachments.length === 0
  );

  assert.equal(uploadCalled, false);
  assert.equal(objectStateCalled, false);
  assert.equal(persistCalled, false);
});

test("a batch timeout waits for in-flight persistence to settle", async () => {
  let persistenceSettled = false;
  const files = parseAndValidateAttachmentsBody({ task_id: 1, files: [FILE] }).files;

  await assert.rejects(
    () =>
      storeAttachmentBatch(
        files,
        { taskId: 1, targetKey: "description-abc" },
        async (uploads, signal) => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          persistenceSettled = true;
          assert.equal(signal.aborted, true);
          return uploads.map((upload, index) => ({
            id: index + 1,
            fileName: upload.filename,
            fileType: upload.contentType,
            fileSource: upload.url,
          }));
        },
        {
          batchTimeoutMs: 5,
          upload: async (_buffer, _filename, _contentType, key) =>
            `https://files.hypertask.app/${key}`,
        }
      ),
    (error) =>
      error instanceof AttachmentBatchError && error.cleanupConfirmed === false
  );

  assert.equal(persistenceSettled, true);
});

test("preparation failures report every file that was not attempted", async () => {
  const urlFile = {
    filename: "remote.png",
    content_type: "image/png",
    url: "https://example.com/remote.png",
  };
  const laterFile = distinctPngFile("later.png", 2);
  const files = parseAndValidateAttachmentsBody({
    task_id: 1,
    files: [FILE, urlFile, laterFile],
  }).files;
  let uploadCalled = false;

  await assert.rejects(
    () =>
      storeAttachmentBatch(
        files,
        { taskId: 1, targetKey: "description-abc" },
        async () => [],
        {
          fetchUrl: async () => {
            throw new Error("remote fetch failed");
          },
          upload: async () => {
            uploadCalled = true;
            return "unexpected";
          },
        }
      ),
    (error) =>
      error instanceof AttachmentBatchError &&
      error.failedFiles.length === 3 &&
      error.failedFiles[0].index === 0 &&
      error.failedFiles[0].filename === FILE.filename &&
      error.failedFiles[1].index === 1 &&
      error.failedFiles[1].filename === "remote.png" &&
      error.failedFiles[2].index === 2 &&
      error.failedFiles[2].filename === "later.png" &&
      /Not attempted/.test(error.failedFiles[0].error) &&
      /remote fetch failed/.test(error.failedFiles[1].error)
  );

  assert.equal(uploadCalled, false);
});

test("a database transaction failure retains bounded deterministic objects", async () => {
  const deleted = [];
  const secondFile = distinctPngFile("second.png", 3);
  const files = parseAndValidateAttachmentsBody({
    task_id: 1,
    files: [FILE, secondFile],
  }).files;

  await assert.rejects(
    () =>
      storeAttachmentBatch(
        files,
        { taskId: 1, targetKey: "description-abc" },
        async (uploads) => {
          assert.equal(uploads.some((upload) => "buffer" in upload), false);
          throw new Error("transaction rolled back");
        },
        {
          buildKey: ({ fileName }) => `tasks/attachments/${fileName}`,
          objectState: async () => "unknown",
          upload: async (_buffer, _filename, _contentType, key) =>
            `https://files.hypertask.app/${key}`,
          deleteObject: async (key) => {
            deleted.push(key);
            return true;
          },
        }
      ),
    (error) =>
      error instanceof AttachmentBatchError && error.cleanupConfirmed === false
  );

  assert.deepEqual(deleted, []);
});

test("a lost commit acknowledgement reconciles rows instead of deleting their objects", async () => {
  const rows = [];
  const deleted = [];
  let nextId = 1;
  const attachmentModel = {
    async findFirst({ where }) {
      return rows.find((row) => row.fileSource === where.fileSource) ?? null;
    },
    async create({ data }) {
      const row = {
        id: nextId++,
        fileName: data.fileName,
        fileType: data.fileType,
        fileSource: data.fileSource,
      };
      rows.push(row);
      return row;
    },
    async findMany({ where }) {
      return rows.filter((row) => where.fileSource.in.includes(row.fileSource));
    },
  };
  let transactionCount = 0;
  const db = {
    attachment: attachmentModel,
    async $transaction(callback) {
      transactionCount += 1;
      const result = await callback({
        attachment: attachmentModel,
        $queryRaw: async () => [],
      });
      if (transactionCount === 1) throw new Error("commit response lost");
      return result;
    },
  };
  const files = parseAndValidateAttachmentsBody({ task_id: 1, files: [FILE] }).files;

  const result = await storeAttachmentBatchWithTargetLock(
    db,
    files,
    { taskId: 1, targetKey: "description-abc" },
    { taskId: 1, commentId: null, descriptionId: "description-abc" },
    {
      withTargetLock: async (_key, callback) => callback(() => {}),
      buildKey: () => "tasks/attachments/evidence.png",
      objectState: async () => "missing",
      upload: async () =>
        "https://files.hypertask.app/tasks/attachments/evidence.png",
      deleteObject: async (key) => {
        deleted.push(key);
        return true;
      },
    }
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].id, rows[0].id);
  assert.deepEqual(deleted, []);
});

test("an unavailable commit reconciliation leaves deterministic objects intact", async () => {
  const deleted = [];
  const db = {
    attachment: {
      async findMany() {
        throw new Error("database unavailable");
      },
    },
    async $transaction() {
      throw new Error("commit outcome unknown");
    },
  };
  const files = parseAndValidateAttachmentsBody({ task_id: 1, files: [FILE] }).files;

  await assert.rejects(
    () =>
      storeAttachmentBatchWithTargetLock(
        db,
        files,
        { taskId: 1, targetKey: "description-abc" },
        { taskId: 1, commentId: null, descriptionId: "description-abc" },
        {
          withTargetLock: async (_key, callback) => callback(() => {}),
          buildKey: () => "tasks/attachments/evidence.png",
          objectState: async () => "unknown",
          upload: async () =>
            "https://files.hypertask.app/tasks/attachments/evidence.png",
          deleteObject: async (key) => {
            deleted.push(key);
            return true;
          },
        }
      ),
    (error) =>
      error?.name === "AttachmentBatchError" && error.cleanupConfirmed === false
  );

  assert.deepEqual(deleted, []);
});

test("cleanup failure is observable and retries reuse the same storage key", async () => {
  const input = {
    taskId: 1,
    targetKey: "description-abc",
    fileName: FILE.filename,
    contentType: FILE.content_type,
    buffer: Buffer.from(FILE.data, "base64"),
  };
  assert.equal(
    buildTaskAttachmentStorageKey(input),
    buildTaskAttachmentStorageKey(input)
  );
  const deterministicUrl = `https://hypertasks.s3.us-east-2.amazonaws.com/${buildTaskAttachmentStorageKey(input)}`;
  assert.equal(
    isDeterministicTaskAttachmentForTarget(
      deterministicUrl,
      input.taskId,
      input.targetKey
    ),
    true
  );
  assert.equal(
    isDeterministicTaskAttachmentForTarget(
      deterministicUrl,
      input.taskId,
      "description-other"
    ),
    false
  );

  await assert.rejects(
    () =>
      storeAttachmentBatch(
        [parseAndValidateAttachmentsBody({ task_id: 1, files: [FILE] }).files[0]],
        { taskId: 1, targetKey: "description-abc" },
        async () => [],
        {
          objectState: async () => "unknown",
          upload: async () => {
            throw new Error("response lost");
          },
          deleteObject: async () => false,
        }
      ),
    (error) =>
      error?.name === "AttachmentBatchError" && error.cleanupConfirmed === false
  );
});

test("storage identity preserves distinct valid filenames after sanitizing", () => {
  const common = {
    taskId: 1,
    targetKey: "description-abc",
    contentType: FILE.content_type,
    buffer: Buffer.from(FILE.data, "base64"),
  };
  const spaced = buildTaskAttachmentStorageKey({ ...common, fileName: "a b.txt" });
  const underscored = buildTaskAttachmentStorageKey({
    ...common,
    fileName: "a_b.txt",
  });

  assert.notEqual(spaced, underscored);

  const alternateMime = buildTaskAttachmentStorageKey({
    ...common,
    fileName: "a b.txt",
    contentType: "application/octet-stream",
  });
  assert.notEqual(spaced, alternateMime);

  const reserved = buildTaskAttachmentStorageKey({
    ...common,
    fileName: "a?b#c.png",
  });
  assert.equal(reserved.includes("?"), false);
  assert.equal(reserved.includes("#"), false);
});

test("concurrent same-target retries wait through failure and persistence", async () => {
  let lockTail = Promise.resolve();
  const withTargetLock = async (_lockKey, callback) => {
    const predecessor = lockTail;
    let releaseLock;
    lockTail = new Promise((resolve) => {
      releaseLock = resolve;
    });
    await predecessor;
    try {
      return await callback();
    } finally {
      releaseLock();
    }
  };
  const rows = new Map();
  let nextId = 1;
  let transactionOpen = false;
  const db = {
    async $transaction(callback) {
      const tx = {
        async $queryRaw() {
          return [];
        },
        attachment: {
          async findFirst({ where }) {
            return rows.get(where.fileSource) ?? null;
          },
          async create({ data }) {
            const row = {
              id: nextId++,
              fileName: data.fileName,
              fileType: data.fileType,
              fileSource: data.fileSource,
            };
            rows.set(data.fileSource, row);
            return row;
          },
        },
      };
      transactionOpen = true;
      try {
        return await callback(tx);
      } finally {
        transactionOpen = false;
      }
    },
  };

  const objects = new Set();
  const deleted = [];
  let signalFirstUpload;
  let releaseFirstUpload;
  const firstUploadStarted = new Promise((resolve) => {
    signalFirstUpload = resolve;
  });
  const firstUploadGate = new Promise((resolve) => {
    releaseFirstUpload = resolve;
  });
  const parsedFiles = parseAndValidateAttachmentsBody({
    task_id: 1,
    files: [
      FILE,
      distinctPngFile("second.png", 4),
      distinctPngFile("third.png", 5),
    ],
  }).files;
  const target = { taskId: 1, targetKey: "description-abc" };
  const persistenceTarget = {
    taskId: 1,
    commentId: null,
    descriptionId: "description-abc",
  };
  const buildKey = ({ fileName }) => `tasks/attachments/${fileName}`;

  const firstAttempt = storeAttachmentBatchWithTargetLock(
    db,
    parsedFiles,
    target,
    persistenceTarget,
    {
      withTargetLock,
      buildKey,
      upload: async (_buffer, filename, _contentType, key) => {
        assert.equal(transactionOpen, false);
        if (filename === "second.png") throw new Error("second upload failed");
        objects.add(key);
        signalFirstUpload();
        await firstUploadGate;
        return `https://files.hypertask.app/${key}`;
      },
      objectState: async () => "missing",
      deleteObject: async (key) => {
        deleted.push(key);
        return true;
      },
    }
  ).then(
    () => null,
    (error) => error
  );

  await firstUploadStarted;
  const secondAttempt = storeAttachmentBatchWithTargetLock(
    db,
    [parsedFiles[0]],
    target,
    persistenceTarget,
    {
      withTargetLock,
      buildKey,
      upload: async (_buffer, _filename, _contentType, key) => {
        assert.equal(transactionOpen, false);
        objects.add(key);
        return `https://files.hypertask.app/${key}`;
      },
      deleteObject: async () => true,
    }
  );
  releaseFirstUpload();
  const firstError = await firstAttempt;
  const secondResult = await secondAttempt;

  assert.equal(firstError?.name, "AttachmentBatchError");
  assert.equal(firstError.attachments.length, 1);
  assert.equal(firstError.failedFiles[0].index, 1);
  assert.equal(firstError.failedFiles[0].filename, "second.png");
  assert.equal(firstError.failedFiles[1].index, 2);
  assert.equal(firstError.failedFiles[1].filename, "third.png");
  assert.match(firstError.failedFiles[1].error, /Not attempted/);
  assert.deepEqual(deleted, []);
  assert.equal(secondResult.length, 1);
  assert.equal(objects.has("tasks/attachments/evidence.png"), true);
});

test("lost lock ownership fences persistence and cleanup", async () => {
  let ownershipHeld = true;
  let persistCalled = false;
  const deleted = [];
  const db = {
    async $transaction(callback) {
      persistCalled = true;
      return callback({ attachment: {} });
    },
  };
  const files = parseAndValidateAttachmentsBody({ task_id: 1, files: [FILE] }).files;

  await assert.rejects(
    () =>
      storeAttachmentBatchWithTargetLock(
        db,
        files,
        { taskId: 1, targetKey: "description-abc" },
        { taskId: 1, commentId: null, descriptionId: "description-abc" },
        {
          withTargetLock: async (_key, callback) =>
            callback(() => {
              if (!ownershipHeld) throw new Error("lock lost");
            }),
          buildKey: () => "tasks/attachments/evidence.png",
          objectState: async () => "missing",
          upload: async () => {
            ownershipHeld = false;
            return "https://files.hypertask.app/tasks/attachments/evidence.png";
          },
          deleteObject: async (key) => {
            deleted.push(key);
            return true;
          },
        }
      ),
    (error) =>
      error?.name === "AttachmentBatchError" && error.cleanupConfirmed === false
  );

  assert.equal(persistCalled, false);
  assert.deepEqual(deleted, []);
});

test("the transaction advisory lock fences row creation after lease overlap", async () => {
  const lockingSource = fs.readFileSync(
    path.join(root, "src/lib/mcp/attachments/storeLockedBatch.ts"),
    "utf8"
  );
  assert.match(
    lockingSource,
    /pg_advisory_xact_lock\([^)]*\)::text AS lock_result/
  );

  let transactionTail = Promise.resolve();
  const rows = new Map();
  let createCount = 0;
  const db = {
    async $transaction(callback) {
      const predecessor = transactionTail;
      let releaseTransaction;
      transactionTail = new Promise((resolve) => {
        releaseTransaction = resolve;
      });
      let lockAcquired = false;
      const attachment = {
        async findFirst({ where }) {
          assert.equal(lockAcquired, true);
          return rows.get(where.fileSource) ?? null;
        },
        async create({ data }) {
          assert.equal(lockAcquired, true);
          createCount += 1;
          const row = {
            id: createCount,
            fileName: data.fileName,
            fileType: data.fileType,
            fileSource: data.fileSource,
          };
          rows.set(data.fileSource, row);
          return row;
        },
      };
      try {
        return await callback({
          attachment,
          async $queryRaw() {
            await predecessor;
            lockAcquired = true;
            return [];
          },
        });
      } finally {
        releaseTransaction();
      }
    },
  };
  const files = parseAndValidateAttachmentsBody({ task_id: 1, files: [FILE] }).files;
  const dependencies = {
    withTargetLock: async (_key, callback) => callback(() => {}),
    buildKey: () => "tasks/attachments/fenced.png",
    upload: async () => "https://files.hypertask.app/tasks/attachments/fenced.png",
  };

  const results = await Promise.all([
    storeAttachmentBatchWithTargetLock(
      db,
      files,
      { taskId: 1, targetKey: "description-abc" },
      { taskId: 1, commentId: null, descriptionId: "description-abc" },
      dependencies
    ),
    storeAttachmentBatchWithTargetLock(
      db,
      files,
      { taskId: 1, targetKey: "description-abc" },
      { taskId: 1, commentId: null, descriptionId: "description-abc" },
      dependencies
    ),
  ]);

  assert.equal(createCount, 1);
  assert.equal(results[0][0].id, results[1][0].id);
});

test("a failed retry never deletes a deterministic object", async () => {
  const secondFile = distinctPngFile("second.png", 6);
  const files = parseAndValidateAttachmentsBody({
    task_id: 1,
    files: [FILE, secondFile],
  }).files;
  const deleted = [];

  await assert.rejects(
    () =>
      storeAttachmentBatch(
        files,
        { taskId: 1, targetKey: "description-abc" },
        async () => [],
        {
          buildKey: ({ fileName }) => `tasks/attachments/${fileName}`,
          objectState: async (key) =>
            key.endsWith("evidence.png") ? "exists" : "missing",
          upload: async (_buffer, filename, _contentType, key) => {
            if (filename === "second.png") throw new Error("second upload failed");
            return `https://files.hypertask.app/${key}`;
          },
          deleteObject: async (key) => {
            deleted.push(key);
            return true;
          },
        }
      ),
    (error) =>
      error instanceof AttachmentBatchError && error.cleanupConfirmed === true
  );

  assert.deepEqual(deleted, []);
});

test("a retry returns the committed attachment row instead of creating a duplicate", async () => {
  const rows = new Map();
  let createCount = 0;
  const db = {
    attachment: {
      async findFirst({ where }) {
        return rows.get(where.fileSource) ?? null;
      },
      async create({ data }) {
        createCount += 1;
        const row = {
          id: createCount,
          fileName: data.fileName,
          fileType: data.fileType,
          fileSource: data.fileSource,
        };
        rows.set(data.fileSource, row);
        return row;
      },
    },
  };
  const uploads = [{
    filename: FILE.filename,
    contentType: FILE.content_type,
    fileSize: 8,
    url: "https://files.hypertask.app/tasks/attachments/stable-key",
  }];
  const target = { taskId: 1, commentId: null, descriptionId: "description-abc" };

  const first = await persistAttachmentRows(db, uploads, target);
  const retry = await persistAttachmentRows(db, uploads, target);

  assert.equal(createCount, 1);
  assert.equal(first[0].id, retry[0].id);
});

test("ticket-number comment attachments preserve project scoping", async () => {
  const client = recordingClient(({ url }) => {
    if (url === "/mcp/comments") {
      return {
        success: true,
        comment: { id: 74, text: "<p>Scoped</p>", createdAt: "2026-08-08T00:00:00.000Z" },
      };
    }
    if (url === "/mcp/tasks/attachments") return { success: true, attachments: [] };
    throw new Error(`Unexpected request: ${url}`);
  });

  await new CommentService(client).addComment({
    ticket_number: "HTPR-3099",
    project_id: 15,
    text: "<p>Scoped</p>",
    attachments: [FILE],
  });

  assert.deepEqual(client.requests[1].body, {
    ticket_number: "HTPR-3099",
    project_id: 15,
    comment_id: 74,
    files: [FILE],
  });
  assert.equal(
    parseAndValidateAttachmentsBody(client.requests[1].body).project_id,
    15
  );
});

test("task-id comment attachments omit the optional project scope", async () => {
  const client = recordingClient(({ url }) => {
    if (url === "/mcp/comments") {
      return {
        success: true,
        comment: { id: 75, text: "<p>Scoped</p>", createdAt: "2026-08-08T00:00:00.000Z" },
      };
    }
    if (url === "/mcp/tasks/attachments") {
      return {
        success: true,
        attachments: [{
          id: 12,
          fileName: FILE.filename,
          fileType: FILE.content_type,
          fileSize: 8,
        }],
      };
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  await new CommentService(client).addComment({
    task_id: 42,
    project_id: 15,
    text: "<p>Scoped</p>",
    attachments: [FILE],
  });

  assert.deepEqual(client.requests[1].body, {
    task_id: 42,
    comment_id: 75,
    files: [FILE],
  });
});

test("MCP file validation matches the API filename and identifier constraints", () => {
  assert.equal(
    AttachFilesInputSchema.safeParse({
      ticket_number: "HTPR-3099",
      project_id: 15,
      files: [FILE],
    }).success,
    true
  );
  for (const input of [
    { task_id: 1, project_id: 15, files: [FILE] },
    { task_id: 1, files: [{ ...FILE, filename: "a".repeat(256) }] },
    { task_id: 1, files: [{ ...FILE, filename: "folder/file.png" }] },
    { task_id: 1, files: [{ ...FILE, filename: "..hidden.png" }] },
    { task_id: 1, files: [{ ...FILE, filename: "   " }] },
    { task_id: 1, files: [{ ...FILE, filename: "bad\ud800.png" }] },
  ]) {
    assert.equal(AttachFilesInputSchema.safeParse(input).success, false);
  }

  assert.throws(
    () => parseAndValidateAttachmentsBody({
      task_id: 1,
      files: [{ ...FILE, filename: "bad\ud801.png" }],
    }),
    /valid Unicode/
  );

  assert.throws(
    () =>
      parseAndValidateAttachmentsBody({
        task_id: 1,
        ignored: "large untrusted metadata",
        files: [FILE],
      }),
    /Unknown request field/
  );
  assert.throws(
    () =>
      parseAndValidateAttachmentsBody({
        task_id: 1,
        files: [{ ...FILE, ignored: true }],
      }),
    /Unknown files\[0\] field/
  );
  assert.throws(
    () =>
      parseAndValidateAttachmentsBody({
        task_id: 1,
        files: [{
          filename: "remote.png",
          content_type: "image/png",
          url: `https://example.com/${"a".repeat(4096)}`,
        }],
      }),
    /4096 characters or less/
  );
});

test("all three schemas share strict file validation", () => {
  assert.equal(
    CreateTaskInputSchema.safeParse({
      project_id: 15,
      title: "Attached",
      attachments: [FILE],
    }).success,
    true
  );
  assert.equal(
    UpdateTaskInputSchema.safeParse({
      task_id: 44,
      attachments: [FILE],
    }).success,
    true
  );
  assert.equal(
    validateAndSanitizeAddCommentCrudInput({
      action: "add",
      task_id: 44,
      text: "<p>Attached</p>",
      attachments: [FILE],
    }).attachments.length,
    1
  );

  for (const attachments of [
    [{ ...FILE, url: "https://example.com/evidence.png" }],
    [{ filename: "missing.png", content_type: "image/png" }],
    [{ filename: "bad.png", content_type: "image/png", url: "https://" }],
    [{ filename: "bad.png", content_type: "image/png", url: "https://user:pass@example.com/bad.png" }],
    [FILE, FILE],
    [FILE, { ...FILE, filename: "same-content-different-name.png" }],
  ]) {
    assert.equal(
      CreateTaskInputSchema.safeParse({
        project_id: 15,
        title: "Invalid",
        attachments,
      }).success,
      false
    );
  }

  assert.throws(
    () => parseAndValidateAttachmentsBody({ task_id: 1, files: [FILE, FILE] }),
    /files\[1\] duplicates files\[0\]/
  );

  const sameContent = [
    FILE,
    { ...FILE, filename: "same-content-different-name.png" },
  ];
  assert.equal(
    UpdateTaskInputSchema.safeParse({ task_id: 44, attachments: sameContent }).success,
    false
  );
  assert.throws(() =>
    validateAndSanitizeAddCommentCrudInput({
      action: "add",
      task_id: 44,
      text: "<p>Duplicate bytes</p>",
      attachments: sameContent,
    })
  );

  assert.throws(
    () =>
      validateAndSanitizeAddCommentCrudInput({
        action: "update",
        comment_id: 73,
        text: "<p>Updated</p>",
        attachments: [FILE],
      }),
    /attachments are only supported when action is add/
  );
});

test("remote preparation rejects duplicate content before storage writes", async () => {
  const files = parseAndValidateAttachmentsBody({
    task_id: 1,
    files: [
      {
        filename: "same.txt",
        content_type: "text/plain",
        url: "https://example.com/first.txt",
      },
      {
        filename: "renamed.txt",
        content_type: "text/plain",
        url: "https://example.com/second.txt",
      },
    ],
  }).files;
  let uploadCalled = false;

  await assert.rejects(
    () =>
      storeAttachmentBatch(
        files,
        { taskId: 1, targetKey: "description-abc" },
        async () => [],
        {
          fetchUrl: async () => ({
            buffer: Buffer.from("identical remote content"),
            contentType: "text/plain",
          }),
          upload: async () => {
            uploadCalled = true;
            return "unexpected";
          },
        }
      ),
    /files\[1\] duplicates files\[0\] by content/
  );

  assert.equal(uploadCalled, false);
});

test("remote preparation caps aggregate retained bytes before storage writes", async () => {
  const files = parseAndValidateAttachmentsBody({
    task_id: 1,
    files: Array.from({ length: 4 }, (_, index) => ({
      filename: `remote-${index}.txt`,
      content_type: "text/plain",
      url: `https://example.com/remote-${index}.txt`,
    })),
  }).files;
  let uploadCalled = false;

  await assert.rejects(
    () =>
      storeAttachmentBatch(
        files,
        { taskId: 1, targetKey: "description-abc" },
        async () => [],
        {
          fetchUrl: async (url) => {
            const index = Number(url.match(/remote-(\d+)/)?.[1] ?? 0);
            return {
              buffer: Buffer.alloc(10 * 1024 * 1024, 0x61 + index),
              contentType: "text/plain",
            };
          },
          buildKey: ({ fileName }) => `tasks/attachments/${fileName}`,
          upload: async () => {
            uploadCalled = true;
            return "unexpected";
          },
        }
      ),
    /Attachment batch exceeds/
  );

  assert.equal(uploadCalled, false);
});

test("base64 validation accepts standard line wrapping", () => {
  const wrapped = `${FILE.data.slice(0, 4)}\n${FILE.data.slice(4)}`;
  assert.equal(
    CreateTaskInputSchema.safeParse({
      project_id: 15,
      title: "Wrapped base64",
      attachments: [{ ...FILE, data: wrapped }],
    }).success,
    true
  );
  assert.equal(
    parseAndValidateAttachmentsBody({
      task_id: 1,
      files: [{ ...FILE, data: wrapped }],
    }).files[0].buffer.equals(Buffer.from(FILE.data, "base64")),
    true
  );
});

test("inline data stays within the aggregate transport body budget", () => {
  const data = Buffer.alloc(1_575_000, 0x61).toString("base64");
  const files = [
    { filename: "one.txt", content_type: "text/plain", data },
    { filename: "two.txt", content_type: "text/plain", data },
  ];
  assert.equal(
    CreateTaskInputSchema.safeParse({
      project_id: 15,
      title: "Too much inline data",
      attachments: files,
    }).success,
    false
  );
  assert.throws(
    () => parseAndValidateAttachmentsBody({ task_id: 1, files }),
    /Total inline attachment data exceeds/
  );

  const whitespaceHeavyFiles = Array.from({ length: 10 }, (_, index) => ({
    ...FILE,
    filename: `wrapped-${index}.png`,
    data: `${FILE.data}${" ".repeat(500_000)}`,
  }));
  assert.equal(
    CreateTaskInputSchema.safeParse({
      project_id: 15,
      title: "Encoded body too large",
      attachments: whitespaceHeavyFiles,
    }).success,
    false
  );
  assert.throws(
    () =>
      parseAndValidateAttachmentsBody({
        task_id: 1,
        files: whitespaceHeavyFiles,
      }),
    /Total inline attachment input exceeds/
  );
});

test("invalid inline file data is rejected before the primary mutation", async () => {
  const client = recordingClient(() => {
    throw new Error("No API request should be made");
  });
  const service = new TaskService(client);
  const invalidAttachments = [
    [{ ...FILE, content_type: "text/html" }],
    [{ ...FILE, data: "not-base64!" }],
    [{ ...FILE, data: "A".repeat(MCP_ATTACHMENT_MAX_BASE64_CHARACTERS + 1) }],
  ];

  for (const attachments of invalidAttachments) {
    await assert.rejects(() =>
      service.createTask({
        project_id: 15,
        title: "Must not be created",
        attachments,
      })
    );
  }

  assert.deepEqual(client.requests, []);
});

test("URL attachments reject hexadecimal IPv4-mapped private IPv6 addresses", async () => {
  for (const url of [
    "http://[::ffff:7f00:1]/loopback.png",
    "http://[::ffff:a00:1]/private.png",
    "http://[::ffff:c0a8:1]/private.png",
  ]) {
    await assert.rejects(
      () => safeFetchAttachmentUrl(url),
      /disallowed \(private\/reserved\) address/
    );
  }
});

test("oversized remote response bodies cancel their reader", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(5));
      },
      cancel() {
        cancelled = true;
      },
    })
  );

  await assert.rejects(
    () => readBodyWithCap(response, 4, new AbortController().signal),
    /Download exceeds maximum size/
  );
  assert.equal(cancelled, true);
});

test("the MCP handler forwards transport identity and attachment writes rebroadcast", () => {
  const handlerSource = fs.readFileSync(
    path.join(root, "src/lib/mcp-server/handler.ts"),
    "utf8"
  );
  assert.match(handlerSource, /requestId: String\(extra\.requestId\)/);
  assert.match(handlerSource, /sessionId: extra\.sessionId/);
  assert.match(handlerSource, /extra\.requestId === undefined/);
  assert.match(handlerSource, /clientFingerprint: crypto/);
  assert.match(handlerSource, /readRequestBytesWithCap\(/);
  assert.match(handlerSource, /new Request\(request\.url/);
  assert.doesNotMatch(handlerSource, /new Request\(request,\s*\{/);

  const routeSource = fs.readFileSync(
    path.join(root, "src/app/api/mcp/tasks/attachments/route.ts"),
    "utf8"
  );
  assert.match(routeSource, /broadcastTaskComment\(task\.id/);
  assert.match(routeSource, /broadcastTaskChange\(task\.id/);
  assert.match(
    routeSource,
    /e instanceof AttachmentBatchError[\s\S]*'Failed to store attachment\(s\)'/
  );
  assert.doesNotMatch(
    routeSource,
    /broadcastTaskChange\(task\.id,\s*\{\s*originUserId/
  );

  const fetchSource = fs.readFileSync(
    path.join(root, "src/lib/mcp/attachments/safeFetch.ts"),
    "utf8"
  );
  assert.match(fetchSource, /readBodyWithCap\([\s\S]*controller\.signal/);
  assert.match(fetchSource, /finally \{\s*clearTimeout\(timer\)/);
  assert.match(fetchSource, /new Agent\(\{ connect: \{ lookup \} \}\)/);
  assert.match(fetchSource, /dispatcher/);

  const storageSource = fs.readFileSync(
    path.join(root, "src/lib/storage/uploadTaskAttachmentToS3.ts"),
    "utf8"
  );
  assert.match(storageSource, /getHypertasksObjectState\([\s\S]*signal\?: AbortSignal/);
  assert.match(storageSource, /setTimeout\(\(\) => head\.abort\(\)/);

  const descriptionControllerSource = fs.readFileSync(
    path.join(root, "src/utils/controllers/urls/addIntoTaskDesc.ts"),
    "utf8"
  );
  assert.match(descriptionControllerSource, /editorDerivedSources/);
  assert.match(descriptionControllerSource, /filter\(\(\{ Attachment \}\) => Attachment\)/);
  assert.match(
    descriptionControllerSource,
    /!editorDerivedSources\.has\(fileSource\)/
  );
  assert.match(descriptionControllerSource, /replaceableAttachmentIds/);
});

test("stateless invocation keys are stable and scoped by token and operation", () => {
  const invocation = { requestId: "77", clientFingerprint: "token-a" };
  const payload = { title: "first", attachments: [FILE] };
  const key = idempotencyKeyForInvocation("create_task", invocation, payload);
  assert.equal(
    key,
    idempotencyKeyForInvocation("create_task", invocation, payload)
  );
  assert.notEqual(
    key,
    idempotencyKeyForInvocation("create_task", {
      ...invocation,
      clientFingerprint: "token-b",
    }, payload)
  );
  assert.notEqual(
    key,
    idempotencyKeyForInvocation("update_task", invocation, payload)
  );
  assert.notEqual(
    key,
    idempotencyKeyForInvocation("create_task", invocation, {
      ...payload,
      title: "second",
    })
  );
  assert.notEqual(
    key,
    idempotencyKeyForInvocation(
      "create_task",
      { ...invocation, sessionId: "new-session" },
      payload
    )
  );
  assert.equal(
    idempotencyKeyForInvocation("create_task", {
      requestId: "",
      clientFingerprint: "token-a",
    }, payload),
    undefined
  );
});
