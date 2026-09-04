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
const ignoreDiscard = async () => undefined;
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

  const first = uploads.startCreateTaskUpload(
    selected,
    upload,
    undefined,
    ignoreDiscard,
  );
  const second = uploads.startCreateTaskUpload(selected, upload);

  assert.equal(second.id, first.id);
  assert.equal(second.promise, first.promise);
  assert.equal(calls, 1);

  finish({ url: "https://files.example/reused", receipt: "receipt-reused" });
  await first.promise;
  uploads.discardUnboundCreateTaskUploads([selected]);
});

test("discard cleans up completed and still-uploading objects by receipt", async () => {
  const discarded = [];
  const discard = async (receipt) => discarded.push(receipt);
  const completedFile = file("discard-complete.txt");
  const completed = uploads.startCreateTaskUpload(
    completedFile,
    async () => ({
      url: "https://files.example/discard-complete",
      receipt: "discard-complete-receipt",
    }),
    async () => attachment(6, "https://files.example/discard-complete"),
    discard,
  );
  await completed.promise;
  await nextTurn();
  uploads.discardUnboundCreateTaskUploads([completedFile]);
  await nextTurn();

  let finishUpload;
  const pendingFile = file("discard-pending.txt");
  const pending = uploads.startCreateTaskUpload(
    pendingFile,
    () =>
      new Promise((resolve) => {
        finishUpload = resolve;
      }),
    async () => attachment(7, "https://files.example/discard-pending"),
    discard,
  );
  uploads.discardUnboundCreateTaskUploads([pendingFile]);
  finishUpload({
    url: "https://files.example/discard-pending",
    receipt: "discard-pending-receipt",
  });
  await pending.promise;
  await nextTurn();

  assert.deepEqual(discarded, [
    "discard-complete-receipt",
    "discard-pending-receipt",
  ]);
  assert.equal(uploads.createTaskUploadById(completed.id), undefined);
  assert.equal(uploads.createTaskUploadById(pending.id), undefined);
});

test("a synchronous uploader failure becomes a retryable job", async () => {
  const selected = file("sync-failure.txt");
  let calls = 0;
  const started = uploads.startCreateTaskUpload(
    selected,
    () => {
      calls += 1;
      if (calls === 1) throw new Error("synchronous failure");
      return Promise.resolve({
        url: "https://files.example/sync-failure",
        receipt: "sync-failure-receipt",
      });
    },
    undefined,
    ignoreDiscard,
  );

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

test("task detail renders upload progress, failure, and a working Retry", async () => {
  const fs = require("node:fs");
  const React = require("react");
  const { JSDOM } = require("jsdom");
  const previousWindow = global.window;
  const previousDocument = global.document;
  const previousReact = global.React;
  const previousNavigator = global.navigator;
  const previousActEnvironment = global.IS_REACT_ACT_ENVIRONMENT;
  const previousCssLoader = require.extensions[".css"];
  const uploadsPath = path.join(root, "src/lib/createTaskAttachmentUploads.ts");
  const previousUploadsModule = require.cache[uploadsPath];
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://app.hypertask.ai/detail/project-15/99",
  });
  let reactRoot;
  let started;

  try {
    global.window = dom.window;
    global.document = dom.window.document;
    global.React = React;
    global.navigator = dom.window.navigator;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    require.extensions[".css"] = () => undefined;
    require.cache[uploadsPath] = {
      id: uploadsPath,
      filename: uploadsPath,
      loaded: true,
      exports: uploads,
    };

    const load = require("jiti")(__filename, {
      interopDefault: true,
      jsx: true,
      alias: { "@": path.join(root, "src") },
      cache: false,
    });
    const BackgroundTaskAttachments = load(
      path.join(
        root,
        "src/components/PageComponents/TaskDetail/CommentAndDescription/BackgroundTaskAttachments.tsx",
      ),
    ).default;
    const selected = file("visible-retry.txt");
    let uploadCalls = 0;
    let reportProgress;
    let failUpload;
    const firstUpload = new Promise((_resolve, reject) => {
      failUpload = reject;
    });
    started = uploads.startCreateTaskUpload(
      selected,
      async (_file, onProgress) => {
        uploadCalls += 1;
        reportProgress = onProgress;
        if (uploadCalls === 1) return firstUpload;
        return {
          url: "https://files.example/visible-retry",
          receipt: "visible-retry-receipt",
        };
      },
      async () => attachment(8, "https://files.example/visible-retry"),
      ignoreDiscard,
    );
    uploads.bindCreateTaskUploads(99, [selected]);
    const linked = [];
    const container = document.getElementById("root");
    reactRoot = require("react-dom/client").createRoot(container);

    await React.act(async () => {
      reactRoot.render(
        React.createElement(BackgroundTaskAttachments, {
          taskId: 99,
          onLinked: (value) => linked.push(value),
        }),
      );
    });
    assert.ok(container.querySelector('[aria-label="Uploading"]'));
    const progressPath = container.querySelector(".CircularProgressbar-path");
    const initialProgressStyle = progressPath.getAttribute("style");
    await React.act(async () => reportProgress(55));
    assert.notEqual(progressPath.getAttribute("style"), initialProgressStyle);

    const rejected = assert.rejects(started.promise, /visible failure/);
    await React.act(async () => {
      failUpload(new Error("visible failure"));
      await rejected;
      await nextTurn();
    });
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Retry",
    );
    assert.ok(retry);

    await React.act(async () => {
      retry.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await nextTurn();
      await nextTurn();
    });
    assert.equal(uploadCalls, 2);
    assert.equal(linked.length, 1);
    assert.equal(container.querySelector("button"), null);

    const detail = fs.readFileSync(
      path.join(
        root,
        "src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/DescriptonBody.tsx",
      ),
      "utf8",
    );
    assert.match(detail, /<BackgroundTaskAttachments[\s\S]*?taskId=\{task\.id\}/);
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    if (started && uploads.createTaskUploadById(started.id)) {
      uploads.acknowledgeCreateTaskUpload(started.id);
    }
    dom.window.close();
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
    if (previousReact === undefined) delete global.React;
    else global.React = previousReact;
    if (previousNavigator === undefined) delete global.navigator;
    else global.navigator = previousNavigator;
    if (previousActEnvironment === undefined) delete global.IS_REACT_ACT_ENVIRONMENT;
    else global.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    if (previousCssLoader === undefined) delete require.extensions[".css"];
    else require.extensions[".css"] = previousCssLoader;
    if (previousUploadsModule === undefined) delete require.cache[uploadsPath];
    else require.cache[uploadsPath] = previousUploadsModule;
  }
});
