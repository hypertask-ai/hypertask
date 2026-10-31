const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { Readable } = require("node:stream");
const ts = require("typescript");


process.env.SESSION_SECRET ||= "upload-session-test-secret";

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: {
    "@": path.join(root, "src"),
  },
});

const { signSession, SESSION_COOKIE } = jiti(
  path.join(root, "src/lib/auth/session.ts")
);
const { verifyTaskAttachmentLinkReceipt } = jiti(
  path.join(root, "src/lib/storage/uploadGrant.ts")
);

const source = fs.readFileSync(
  path.join(root, "src/pages/api/tasks/n8nUpload.ts"),
  "utf8"
);
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

const UPLOADED_URL = "https://files.hypertask.app/tasks/attachments/x_t.txt";

function loadRoute(sessionUser = null) {
  const uploaded = [];
  const seenHeaders = [];
  const stubs = {
    "@/lib/auth/getSessionUser": {
      getSessionUser: async (headers) => {
        seenHeaders.push(headers);
        return sessionUser;
      },
    },
    "@/lib/flags": {
      isFeatureEnabled: async () => {
        throw new Error("background task uploads no longer read a feature flag");
      },
    },
    "@/lib/storage/uploadTaskAttachmentToS3": {
      parseHypertasksAttachmentKeyFromUrl: () =>
        "tasks/attachments/x_t.txt",
      uploadTaskAttachmentToS3: async (buffer, fileName, fileType) => {
        uploaded.push({ fileName, fileType, size: buffer.length });
        return UPLOADED_URL;
      },
    },
  };

  const resolve = (request) => {
    if (stubs[request]) return stubs[request];
    if (request.startsWith("@/")) {
      return jiti(path.join(root, "src", request.slice(2)));
    }
    return require(request);
  };

  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) =>
    stubs[request] ?? originalLoad(request, parent, isMain);
  try {
    const mod = { exports: {} };
    new Function("module", "exports", "require", javascript)(
      mod,
      mod.exports,
      resolve
    );
    return { route: mod.exports, uploaded, seenHeaders };
  } finally {
    Module._load = originalLoad;
  }
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    setHeader() {},
  };
}

function uploadRequest({ cookies = {}, cookieHeader, purpose } = {}) {
  const boundary = "upload-boundary";
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="t.txt"\r\nContent-Type: text/plain\r\n\r\n`
    ),
    Buffer.from("hello world"),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return Object.assign(Readable.from([body]), {
    method: "POST",
    cookies,
    headers: {
      "content-type": `multipart/form-data; boundary="${boundary}"`,
      "content-length": String(body.length),
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
      ...(purpose ? { "x-upload-purpose": purpose } : {}),
    },
  });
}

test("upload accepts a Better Auth session when ht_session has expired", async () => {
  const { route, uploaded, seenHeaders } = loadRoute({
    userId: 6,
    source: "better-auth",
  });
  const res = responseRecorder();

  await route.default(uploadRequest({ cookies: {} }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.fileUrls, [UPLOADED_URL]);
  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].fileName, "t.txt");
  assert.equal(seenHeaders.length, 1);
  assert.match(seenHeaders[0].get("content-type"), /multipart\/form-data/);
});

test("upload still accepts a valid legacy ht_session without the fallback", async () => {
  const { route, uploaded, seenHeaders } = loadRoute(null);
  const res = responseRecorder();

  await route.default(
    uploadRequest({ cookies: { [SESSION_COOKIE]: signSession({ id: 6 }) } }),
    res
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.fileUrls, [UPLOADED_URL]);
  assert.equal(uploaded.length, 1);
  assert.equal(seenHeaders.length, 0);
});

test("upload rejects a request with neither session source", async () => {
  const { route, uploaded } = loadRoute(null);
  const res = responseRecorder();

  await route.default(uploadRequest({ cookies: {} }), res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "SESSION_REQUIRED");
  assert.equal(uploaded.length, 0);
});

test("buffered uploads return a receipt with the actual uploaded size", async () => {
  const { route, uploaded } = loadRoute({ userId: 6, source: "better-auth" });
  const res = responseRecorder();

  await route.default(
    uploadRequest({
      cookies: {},
      purpose: "task-attachment-link",
    }),
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(uploaded.length, 1);
  const receipt = verifyTaskAttachmentLinkReceipt(
    res.body.taskLinkReceipts?.[0],
  );
  assert.deepEqual(receipt, {
    userId: 6,
    key: "tasks/attachments/x_t.txt",
    fileName: "t.txt",
    contentType: "text/plain",
    fileSize: 11,
  });
});

let finalizeLoadId = 0;

function loadFinalizeRoute({ linked = false } = {}) {
  const deleted = [];
  const linkCalls = [];
  const receipt = {
    userId: 6,
    key: "tasks/attachments/x_t.txt",
    fileName: "t.txt",
    contentType: "text/plain",
    fileSize: 11,
  };
  class TaskAttachmentLinkError extends Error {}
  const prisma = {
    attachment: {
      findFirst: async () => (linked ? { id: 1 } : null),
    },
  };
  const stubs = {
    "@/lib/auth/getSessionUser": { getSessionUser: async () => null },
    "@/lib/auth/session": {
      SESSION_COOKIE: "ht_session",
      verifySession: () => ({ id: 6 }),
    },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/storage/directUpload": {
      DIRECT_UPLOAD_MAX_BATCH_BYTES: 100,
      DIRECT_UPLOAD_MAX_FILES: 5,
      DIRECT_UPLOAD_MAX_FILE_BYTES: 100,
    },
    "@/lib/storage/uploadGrant": {
      signTaskAttachmentLinkReceipt: () => "signed",
      TASK_ATTACHMENT_LINK_RECEIPT_TTL_SECONDS: 60,
      verifyTaskAttachmentLinkReceipt: (token) =>
        token === "valid-receipt" ? receipt : null,
      verifyUploadGrant: () => null,
    },
    "@/lib/storage/linkTaskAttachment": {
      discardTaskAttachment: async (_userId, verifiedReceipt) => {
        if (!linked) deleted.push(verifiedReceipt.key);
        return !linked;
      },
      linkTaskAttachment: async (...args) => {
        linkCalls.push(args);
        return { id: 1 };
      },
      TaskAttachmentLinkError,
    },
    "@/lib/realtime/server": { broadcastTaskChange: async () => undefined },
    "@/lib/storage/hypertasksS3": {
      getHypertasksS3Client: () => ({
        deleteObject: ({ Key }) => ({
          promise: async () => deleted.push(Key),
        }),
      }),
      getHypertasksStoragePublicUrl: (key) => `https://files.example/${key}`,
      HYPERTASKS_S3_BUCKET: "test-bucket",
    },
    "@/lib/storage/uploadTaskAttachmentToS3": {
      TASK_ATTACHMENT_PREFIX: "tasks/attachments",
    },
    "@/lib/flags": {
      isFeatureEnabled: async () => {
        throw new Error("attachment linking no longer reads a feature flag");
      },
    },
  };
  for (const [request, exports] of Object.entries(stubs)) {
    const filename = path.join(root, "src", `${request.slice(2)}.ts`);
    require.cache[filename] = {
      id: filename,
      filename,
      loaded: true,
      exports,
    };
  }
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) =>
    stubs[request] ?? originalLoad(request, parent, isMain);
  try {
    for (const file of [
      "src/pages/api/tasks/uploadFinalize.ts",
      "src/lib/api/task-writes/upload-finalize.ts",
    ]) {
      delete require.cache[path.join(root, file)];
    }
    const load = require("jiti")(
      path.join(root, `tests/upload-finalize-${++finalizeLoadId}.cjs`),
      {
        interopDefault: true,
        alias: {
          "@": path.join(root, "src"),
        },
        cache: false,
      },
    );
    const route = load(
      path.join(root, "src/pages/api/tasks/uploadFinalize.ts"),
    );
    return { route, deleted, linkCalls };
  } finally {
    Module._load = originalLoad;
  }
}

function finalizeRequest(action) {
  return {
    method: "POST",
    cookies: {},
    headers: {},
    body: { action, receipt: "valid-receipt", taskId: 99 },
  };
}

test("final attachment linking links a valid receipt without reading a feature flag", async () => {
  const { route, linkCalls } = loadFinalizeRoute();
  const res = responseRecorder();

  await route.default(finalizeRequest("link-task-attachment"), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true, attachment: { id: 1 } });
  assert.equal(linkCalls.length, 1);
  assert.equal(linkCalls[0][0], 99);
});

test("final attachment linking still refuses an invalid receipt", async () => {
  const { route, linkCalls } = loadFinalizeRoute();
  const res = responseRecorder();

  await route.default(
    { ...finalizeRequest("link-task-attachment"), body: { action: "link-task-attachment", receipt: "forged", taskId: 99 } },
    res,
  );

  assert.equal(res.statusCode, 400);
  assert.equal(linkCalls.length, 0);
});

test("discard removes only an upload that has not been linked", async () => {
  const unlinked = loadFinalizeRoute({ linked: false });
  const unlinkedResponse = responseRecorder();
  await unlinked.route.default(
    finalizeRequest("discard-task-attachment"),
    unlinkedResponse,
  );
  assert.equal(unlinkedResponse.statusCode, 200);
  assert.equal(unlinkedResponse.body.discarded, true);
  assert.deepEqual(unlinked.deleted, ["tasks/attachments/x_t.txt"]);

  const linked = loadFinalizeRoute({ linked: true });
  const linkedResponse = responseRecorder();
  await linked.route.default(
    finalizeRequest("discard-task-attachment"),
    linkedResponse,
  );
  assert.equal(linkedResponse.statusCode, 200);
  assert.equal(linkedResponse.body.discarded, false);
  assert.deepEqual(linked.deleted, []);
});
