const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const uploads = jiti(
  path.join(root, "src/lib/createTaskAttachmentUploads.ts"),
);

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));
const file = (name) => new File([name], name, { type: "text/plain" });
const attachment = (id, source) => ({
  id,
  createdAt: new Date(),
  fileName: `file-${id}.txt`,
  fileType: "text/plain",
  fileSize: "4",
  fileSource: source,
  descriptionId: "description-1",
  taskId: 99,
});

test("one file object starts one upload promise across remounts", async () => {
  const selected = file("promise-reuse.txt");
  let calls = 0;
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const upload = async () => {
    calls += 1;
    return pending;
  };

  const first = uploads.startCreateTaskUpload(selected, upload);
  const second = uploads.startCreateTaskUpload(selected, upload);

  assert.equal(second.id, first.id);
  assert.equal(second.promise, first.promise);
  assert.equal(calls, 1);

  finish({ url: "https://files.example/reused", receipt: "receipt-reused" });
  await first.promise;
  uploads.discardUnboundCreateTaskUploads([selected]);
});

test("a synchronous uploader failure becomes a retryable job", async () => {
  const selected = file("sync-failure.txt");
  let calls = 0;
  const started = uploads.startCreateTaskUpload(selected, () => {
    calls += 1;
    if (calls === 1) throw new Error("synchronous failure");
    return Promise.resolve({
      url: "https://files.example/sync-failure",
      receipt: "sync-failure-receipt",
    });
  });

  await assert.rejects(started.promise, /synchronous failure/);
  await nextTurn();
  assert.equal(uploads.createTaskUploadById(started.id).status, "upload-failed");

  uploads.retryCreateTaskUpload(started.id);
  await nextTurn();
  assert.equal(calls, 2);
  assert.equal(uploads.createTaskUploadById(started.id).status, "uploaded");
  uploads.discardUnboundCreateTaskUploads([selected]);
});

test("a marked attachment resolves its upload job without a wrapper", async () => {
  const selected = file("direct-marker.txt");
  const started = uploads.startCreateTaskUpload(
    selected,
    async () => ({
      url: "https://files.example/direct-marker",
      receipt: "direct-marker-receipt",
    }),
    async () => attachment(4, "https://files.example/direct-marker"),
  );
  const uploaded = await started.promise;
  const marked = uploads.markedCreateTaskAttachment(
    started.id,
    selected,
    uploaded.url,
  );

  assert.equal(uploads.createTaskUploadCount([marked]), 1);
  assert.equal(uploads.bindCreateTaskUploads(99, [marked]), 1);
  await nextTurn();
  assert.equal(uploads.createTaskUploadById(started.id).status, "complete");
  uploads.acknowledgeCreateTaskUpload(started.id);
});

test("a reserved upload binds and finishes after the composer unmounts", async () => {
  const selected = file("survives-unmount.txt");
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const linked = [];
  const started = uploads.startCreateTaskUpload(
    selected,
    async () => pending,
    async (taskId, receipt) => {
      linked.push({ taskId, receipt });
      return attachment(1, "https://files.example/survives-unmount");
    },
  );

  uploads.reserveCreateTaskUploads([selected]);
  uploads.discardUnboundCreateTaskUploads([selected]);
  assert.ok(uploads.createTaskUploadById(started.id));
  assert.equal(uploads.bindCreateTaskUploads(99, [selected]), 1);

  finish({
    url: "https://files.example/survives-unmount",
    receipt: "receipt-after-unmount",
  });
  await started.promise;
  await nextTurn();

  assert.deepEqual(linked, [
    { taskId: 99, receipt: "receipt-after-unmount" },
  ]);
  assert.equal(uploads.createTaskUploadById(started.id).status, "complete");
  uploads.acknowledgeCreateTaskUpload(started.id);
});

test("an upload cannot be rebound while its first task link is pending", async () => {
  const selected = file("single-task-binding.txt");
  const linkedTaskIds = [];
  let finishLink;
  const started = uploads.startCreateTaskUpload(
    selected,
    async () => ({
      url: "https://files.example/single-task-binding",
      receipt: "single-task-binding-receipt",
    }),
    (taskId) => {
      linkedTaskIds.push(taskId);
      return new Promise((resolve) => {
        finishLink = resolve;
      });
    },
  );
  await started.promise;

  assert.equal(uploads.bindCreateTaskUploads(99, [selected]), 1);
  assert.equal(uploads.bindCreateTaskUploads(100, [selected]), 0);
  assert.equal(uploads.createTaskUploadById(started.id).taskId, 99);

  finishLink(attachment(5, "https://files.example/single-task-binding"));
  await nextTurn();
  assert.deepEqual(linkedTaskIds, [99]);
  assert.equal(uploads.createTaskUploadsForTask(99).length, 1);
  assert.equal(uploads.createTaskUploadsForTask(100).length, 0);
  uploads.acknowledgeCreateTaskUpload(started.id);
});

test("a cancelled reserved upload is discarded when its save releases", () => {
  const selected = file("cancelled-save.txt");
  const started = uploads.startCreateTaskUpload(
    selected,
    async () => new Promise(() => {}),
  );

  uploads.reserveCreateTaskUploads([selected]);
  uploads.discardUnboundCreateTaskUploads([selected]);
  assert.ok(uploads.createTaskUploadById(started.id));

  uploads.releaseCreateTaskUploadReservations([selected]);
  assert.equal(uploads.createTaskUploadById(started.id), undefined);
});

test("Retry uploads again only for upload failure and reuses a receipt for link failure", async () => {
  const selected = file("separate-retries.txt");
  let uploadCalls = 0;
  let linkCalls = 0;
  const upload = async () => {
    uploadCalls += 1;
    if (uploadCalls === 1) throw new Error("storage unavailable");
    return {
      url: "https://files.example/separate-retries",
      receipt: "stable-receipt",
    };
  };
  const link = async (_taskId, receipt) => {
    linkCalls += 1;
    assert.equal(receipt, "stable-receipt");
    if (linkCalls === 1) throw new Error("response was lost");
    return attachment(2, "https://files.example/separate-retries");
  };

  const started = uploads.startCreateTaskUpload(selected, upload, link);
  await assert.rejects(started.promise, /storage unavailable/);
  await nextTurn();
  assert.equal(uploads.createTaskUploadById(started.id).status, "upload-failed");

  uploads.bindCreateTaskUploads(99, [selected]);
  uploads.retryCreateTaskUpload(started.id);
  await nextTurn();
  await nextTurn();
  assert.equal(uploadCalls, 2);
  assert.equal(linkCalls, 1);
  assert.equal(uploads.createTaskUploadById(started.id).status, "link-failed");

  uploads.retryCreateTaskUpload(started.id);
  await nextTurn();
  assert.equal(uploadCalls, 2);
  assert.equal(linkCalls, 2);
  assert.equal(uploads.createTaskUploadById(started.id).status, "complete");
  uploads.acknowledgeCreateTaskUpload(started.id);
});

test("a null link response becomes a retryable failure", async () => {
  const originalFetch = global.fetch;
  const selected = file("null-link-response.txt");
  try {
    global.fetch = async () => ({
      ok: true,
      json: async () => null,
    });
    const started = uploads.startCreateTaskUpload(selected, async () => ({
      url: "https://files.example/null-link-response",
      receipt: "null-response-receipt",
    }));
    uploads.bindCreateTaskUploads(99, [selected]);
    await started.promise;
    await nextTurn();
    assert.equal(uploads.createTaskUploadById(started.id).status, "link-failed");

    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        attachment: attachment(3, "https://files.example/null-link-response"),
      }),
    });
    uploads.retryCreateTaskUpload(started.id);
    await nextTurn();
    assert.equal(uploads.createTaskUploadById(started.id).status, "complete");
    uploads.acknowledgeCreateTaskUpload(started.id);
  } finally {
    global.fetch = originalFetch;
  }
});

test("task detail renders background progress, failure, and Retry wiring", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(
    path.join(
      root,
      "src/components/PageComponents/TaskDetail/CommentAndDescription/BackgroundTaskAttachments.tsx",
    ),
    "utf8",
  );
  const detail = fs.readFileSync(
    path.join(
      root,
      "src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/DescriptonBody.tsx",
    ),
    "utf8",
  );

  assert.match(source, /upload\.status === "upload-failed" \|\| upload\.status === "link-failed"/);
  assert.match(source, /retryCreateTaskUpload\(upload\.id\)/);
  assert.match(source, />\s*Retry\s*</);
  assert.match(source, /CircularProgressbar/);
  assert.match(detail, /<BackgroundTaskAttachments[\s\S]*?taskId=\{task\.id\}/);
});
