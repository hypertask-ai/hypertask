const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { Readable } = require("node:stream");
const ts = require("typescript");

// HTPR-5520: /api/tasks/n8nUpload authenticated against the legacy ht_session
// cookie only. That cookie is minted once at login with a fixed expiry and is
// never refreshed, while the Better Auth session rolls forward on each day of
// use. A user active past the legacy lifetime therefore stayed signed in
// everywhere except uploads, which returned 401 — attachments failed in
// comments and descriptions while text-only comments still posted.
//
// The session resolver and storage are injected so this exercises the route's
// real auth branch without loading Prisma or reaching S3.

process.env.SESSION_SECRET ||= "upload-session-test-secret";

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
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

function loadRoute(sessionUser = null, { flagEnabled = true } = {}) {
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
      isFeatureEnabled: async () => flagEnabled,
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
  };
}

// One small text file over a real Readable, so raw-body consumes the request
// exactly as it does in production.
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
  // The resolver must receive the request's real headers, not an empty set.
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

test("background task upload receipts are gated before bytes reach storage", async () => {
  const { route, uploaded } = loadRoute(
    { userId: 6, source: "better-auth" },
    { flagEnabled: false },
  );
  const res = responseRecorder();

  await route.default(
    uploadRequest({
      cookies: {},
      purpose: "task-attachment-link",
    }),
    res,
  );

  assert.equal(res.statusCode, 403);
  assert.equal(uploaded.length, 0);
});

test("enabled buffered uploads return a receipt with the actual uploaded size", async () => {
  const { route, uploaded } = loadRoute(
    { userId: 6, source: "better-auth" },
    { flagEnabled: true },
  );
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
