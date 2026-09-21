const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

process.env.SESSION_SECRET ||= "n8n-upload-test-secret";

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const uploadRoute = jiti(
  path.join(root, "src/pages/api/tasks/n8nUpload.ts")
);
const { MCP_ATTACHMENT_MAX_BYTES, MCP_ATTACHMENT_MAX_FILES } = jiti(
  path.join(root, "src/lib/mcp/attachments/constants.ts")
);
const { signSession, SESSION_COOKIE } = jiti(
  path.join(root, "src/lib/auth/session.ts")
);

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

function multipart(boundary, files) {
  const parts = [];
  for (const file of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.name}"\r\n${
          file.type ? `Content-Type: ${file.type}\r\n` : ""
        }\r\n`
      ),
      file.bytes,
      Buffer.from("\r\n")
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(parts);
}

test("legacy upload rejects unauthenticated requests before reading the body", async () => {
  let readAttempted = false;
  const req = {
    method: "POST",
    cookies: {},
    headers: { "content-type": "multipart/form-data; boundary=test" },
    async *[Symbol.asyncIterator]() {
      readAttempted = true;
      yield Buffer.from("attacker body");
    },
  };
  const res = responseRecorder();

  await uploadRoute.default(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "SESSION_REQUIRED");
  assert.equal(readAttempted, false);
});

test("legacy upload rejects an oversized declared body before reading it", async () => {
  let readAttempted = false;
  const req = {
    method: "POST",
    cookies: { [SESSION_COOKIE]: signSession({ id: 6 }) },
    headers: {
      "content-type": 'multipart/form-data; boundary="test-boundary"',
      "content-length": String(uploadRoute.LEGACY_UPLOAD_MAX_REQUEST_BYTES + 1),
    },
    async *[Symbol.asyncIterator]() {
      readAttempted = true;
      yield Buffer.from("oversized body");
    },
  };
  const res = responseRecorder();

  await uploadRoute.default(req, res);

  assert.equal(res.statusCode, 413);
  assert.equal(readAttempted, false);
});

test("multipart parsing preserves APK bytes and infers the APK MIME", () => {
  const boundary = "apk-boundary";
  const apk = Buffer.from([
    0x50,
    0x4b,
    0x03,
    0x04,
    ...Buffer.from(
      `bytes containing --${boundary} and\r\n--${boundary}x are not delimiters`
    ),
  ]);
  const body = multipart(boundary, [{ name: "review.apk", bytes: apk }]);

  const files = uploadRoute.extractFilesFromMultipart(body, boundary);

  assert.equal(files.length, 1);
  assert.equal(files[0].fileName, "review.apk");
  assert.equal(files[0].fileType, "application/vnd.android.package-archive");
  assert.deepEqual(files[0].buffer, apk);
});

test("multipart parsing enforces per-file and file-count limits", () => {
  const boundary = "limit-boundary";
  const oversized = multipart(boundary, [
    { name: "too-large.bin", bytes: Buffer.alloc(MCP_ATTACHMENT_MAX_BYTES + 1) },
  ]);
  assert.throws(
    () => uploadRoute.extractFilesFromMultipart(oversized, boundary),
    (error) => error.status === 413 && /exceeds/.test(error.message)
  );

  const tooMany = multipart(
    boundary,
    Array.from({ length: MCP_ATTACHMENT_MAX_FILES + 1 }, (_, index) => ({
      name: `${index}.txt`,
      bytes: Buffer.from("x"),
      type: "text/plain",
    }))
  );
  assert.throws(
    () => uploadRoute.extractFilesFromMultipart(tooMany, boundary),
    (error) => error.status === 413 && /maximum/.test(error.message)
  );
});
