// HTPR-5516: an oversized attachment produced an opaque axios 413 and an
// unhandled rejection. Uploads must be size-checked in the browser and any 413
// must arrive as a plain-language message.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

process.env.SESSION_SECRET ||= "upload-size-test-secret";

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const limits = jiti(path.join(root, "src/lib/storage/uploadLimits.ts"));
const direct = jiti(path.join(root, "src/lib/storage/directUpload.ts"));
const uploadRoute = jiti(path.join(root, "src/pages/api/tasks/n8nUpload.ts"));
const { uploadFilesViaApi, uploadSingleTaskAttachment } = jiti(
  path.join(root, "src/lib/storage/uploadViaApi.ts")
);
const axios = require("axios");

const {
  UPLOAD_MAX_FILE_BYTES,
  UPLOAD_MAX_REQUEST_BYTES,
  UploadTooLargeError,
  getUploadSizeError,
} = limits;

const { DIRECT_UPLOAD_MAX_FILE_BYTES } = direct;

// The browser reaches storage over XHR, which Node does not provide.
function stubXhr(behaviour) {
  const original = global.XMLHttpRequest;
  const sent = [];
  global.XMLHttpRequest = class {
    constructor() {
      this.upload = {};
      this.status = 0;
      this.headers = {};
    }
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(name, value) {
      this.headers[name] = value;
    }
    send(body) {
      sent.push({ url: this.url, headers: this.headers, body });
      behaviour(this);
    }
  };
  return {
    sent,
    restore() {
      global.XMLHttpRequest = original;
    },
  };
}

test("the browser upload cap stays under Vercel's 4.5 MB body limit", () => {
  assert.ok(UPLOAD_MAX_REQUEST_BYTES <= 4.5 * 1024 * 1024);
  assert.ok(UPLOAD_MAX_FILE_BYTES < UPLOAD_MAX_REQUEST_BYTES);
  // The server must never advertise more than the platform actually accepts.
  assert.equal(
    uploadRoute.LEGACY_UPLOAD_MAX_REQUEST_BYTES,
    UPLOAD_MAX_REQUEST_BYTES
  );
});

test("a file within the limit passes validation", () => {
  assert.equal(
    getUploadSizeError([{ name: "small.png", size: 1024 * 1024 }]),
    null
  );
});

test("an oversized file is named in the error message", () => {
  const message = getUploadSizeError([
    { name: "huge.mp4", size: UPLOAD_MAX_FILE_BYTES + 1 },
  ]);
  assert.match(message, /huge\.mp4/);
  assert.match(message, /MB/);
});

test("a batch over the request limit is rejected even when each file fits", () => {
  const each = Math.floor(UPLOAD_MAX_FILE_BYTES * 0.9);
  const message = getUploadSizeError([
    { name: "a.pdf", size: each },
    { name: "b.pdf", size: each },
  ]);
  assert.ok(message);
  assert.match(message, /smaller batches/);
});

test("uploadFilesViaApi rejects a file above the direct-upload ceiling without sending a request", async () => {
  const originalPost = axios.post;
  let posted = false;
  axios.post = async () => {
    posted = true;
    return { data: { fileUrls: ["https://example.com/x"] } };
  };
  try {
    await assert.rejects(
      () =>
        uploadFilesViaApi([
          { name: "huge.zip", size: DIRECT_UPLOAD_MAX_FILE_BYTES + 1 },
        ]),
      (error) => error instanceof UploadTooLargeError
    );
    assert.equal(posted, false);
  } finally {
    axios.post = originalPost;
  }
});

function tinyFile(name) {
  return new File([Buffer.from("tiny")], name, { type: "image/png" });
}

test("a server 413 becomes a readable message instead of a raw axios error", async () => {
  const originalPost = axios.post;
  const originalIsAxiosError = axios.isAxiosError;
  axios.post = async () => {
    const error = new Error("Request failed with status code 413");
    error.response = { status: 413, data: { error: "Upload request is too large" } };
    throw error;
  };
  axios.isAxiosError = () => true;
  try {
    await assert.rejects(
      () => uploadFilesViaApi([tinyFile("ok.png")]),
      (error) =>
        error instanceof UploadTooLargeError &&
        error.message === "Upload request is too large"
    );
  } finally {
    axios.post = originalPost;
    axios.isAxiosError = originalIsAxiosError;
  }
});

test("a platform 413 with no JSON body still yields a readable message", async () => {
  const originalPost = axios.post;
  const originalIsAxiosError = axios.isAxiosError;
  axios.post = async () => {
    const error = new Error("Request failed with status code 413");
    error.response = { status: 413, data: "" };
    throw error;
  };
  axios.isAxiosError = () => true;
  try {
    await assert.rejects(
      () => uploadFilesViaApi([tinyFile("ok.png")]),
      (error) =>
        error instanceof UploadTooLargeError && /too large/i.test(error.message)
    );
  } finally {
    axios.post = originalPost;
    axios.isAxiosError = originalIsAxiosError;
  }
});

// HTPR-5524: a video could not be attached anywhere, because every upload
// transited a Vercel function capped at ~4.5 MB. Large files must now go
// straight to storage with a signed PUT, and the buffered route must remain as
// the fallback for small files.

const uploadUrlRoute = jiti(
  path.join(root, "src/pages/api/tasks/uploadUrl.ts")
);
const uploadGrant = jiti(path.join(root, "src/lib/storage/uploadGrant.ts"));
const finalizeRoute = jiti(
  path.join(root, "src/pages/api/tasks/uploadFinalize.ts")
);
const {
  directUploadContentType,
  safeDirectUploadNameSegment,
  getDirectUploadSizeError,
} = direct;

function bigFile(name, size, type) {
  return { name, size, type };
}

function ticketFor(name) {
  return {
    uploadUrl: `https://storage.example/signed/${name}?sig=1`,
    fileUrl: `https://files.hypertask.app/tasks/attachments/1_${name}`,
    contentType: "video/mp4",
    fileName: name,
    key: `tasks/attachments/1_${name}`,
  };
}

test("a file far above the buffered cap uploads straight to storage", async () => {
  const originalPost = axios.post;
  const calls = [];
  axios.post = async (url, body) => {
    calls.push({ url, body });
    return { data: { uploads: [ticketFor("demo.mp4")], grant: "g" } };
  };
  const xhr = stubXhr((request) => {
    request.status = 200;
    request.onload();
  });
  try {
    const urls = await uploadFilesViaApi([
      bigFile("demo.mp4", 120 * 1024 * 1024, "video/mp4"),
    ]);
    assert.deepEqual(urls, [
      "https://files.hypertask.app/tasks/attachments/1_demo.mp4",
    ]);
    // Only small JSON handshakes crossed the serverless function.
    assert.deepEqual(
      calls.map((call) => call.url),
      ["/api/tasks/uploadUrl", "/api/tasks/uploadFinalize"]
    );
    assert.equal(calls[0].url, "/api/tasks/uploadUrl");
    assert.equal(calls[0].body.files[0].size, 120 * 1024 * 1024);
    // The signature covers Content-Type, so it must be sent exactly as issued.
    assert.equal(xhr.sent.length, 1);
    assert.equal(xhr.sent[0].headers["Content-Type"], "video/mp4");
    assert.match(xhr.sent[0].url, /^https:\/\/storage\.example\//);
  } finally {
    axios.post = originalPost;
    xhr.restore();
  }
});

test("a task-link upload requests and returns a server receipt", async () => {
  const originalPost = axios.post;
  const calls = [];
  axios.post = async (url, body) => {
    calls.push({ url, body });
    if (url === "/api/tasks/uploadUrl") {
      return { data: { uploads: [ticketFor("linked.png")], grant: "g" } };
    }
    return { data: { success: true, taskLinkReceipts: ["signed-receipt"] } };
  };
  const xhr = stubXhr((request) => {
    request.status = 200;
    request.onload();
  });
  try {
    const result = await uploadSingleTaskAttachment(tinyFile("linked.png"));
    assert.deepEqual(result, {
      url: "https://files.hypertask.app/tasks/attachments/1_linked.png",
      receipt: "signed-receipt",
    });
    assert.equal(calls[0].body.purpose, "task-attachment-link");
    assert.equal(calls[1].body.issueTaskLinkReceipts, true);
  } finally {
    axios.post = originalPost;
    xhr.restore();
  }
});

test("a small file falls back to the buffered route when storage is unreachable", async () => {
  const originalPost = axios.post;
  const urlsCalled = [];
  axios.post = async (url) => {
    urlsCalled.push(url);
    if (url === "/api/tasks/uploadUrl") {
      return { data: { uploads: [ticketFor("ok.png")], grant: "g" } };
    }
    return { data: { fileUrls: ["https://files.hypertask.app/x/ok.png"] } };
  };
  const xhr = stubXhr((request) => request.onerror());
  try {
    const urls = await uploadFilesViaApi([tinyFile("ok.png")]);
    assert.deepEqual(urls, ["https://files.hypertask.app/x/ok.png"]);
    // The direct object may have landed before the connection dropped, so it is
    // discarded rather than left beside the buffered copy.
    assert.deepEqual(urlsCalled, [
      "/api/tasks/uploadUrl",
      "/api/tasks/n8nUpload",
      "/api/tasks/uploadFinalize",
    ]);
  } finally {
    axios.post = originalPost;
    xhr.restore();
  }
});

test("a large file does not fall back to a route that could never carry it", async () => {
  const originalPost = axios.post;
  const urlsCalled = [];
  axios.post = async (url) => {
    urlsCalled.push(url);
    return { data: { uploads: [ticketFor("demo.mp4")], grant: "g" } };
  };
  const xhr = stubXhr((request) => request.onerror());
  try {
    await assert.rejects(() =>
      uploadFilesViaApi([bigFile("demo.mp4", 50 * 1024 * 1024, "video/mp4")])
    );
    assert.deepEqual(urlsCalled, ["/api/tasks/uploadUrl"]);
  } finally {
    axios.post = originalPost;
    xhr.restore();
  }
});

test("a storage rejection surfaces instead of silently retrying", async () => {
  const originalPost = axios.post;
  axios.post = async () => ({ data: { uploads: [ticketFor("ok.png")], grant: "g" } });
  const xhr = stubXhr((request) => {
    request.status = 403;
    request.onload();
  });
  try {
    await assert.rejects(
      () => uploadFilesViaApi([tinyFile("ok.png")]),
      /403/
    );
  } finally {
    axios.post = originalPost;
    xhr.restore();
  }
});

test("direct upload reports combined progress across a batch", async () => {
  const originalPost = axios.post;
  axios.post = async () => ({
    data: { uploads: [ticketFor("a.mp4"), ticketFor("b.mp4")], grant: "g" },
  });
  const xhr = stubXhr((request) => {
    request.upload.onprogress({ loaded: 5 * 1024 * 1024 });
    request.status = 200;
    request.onload();
  });
  const seen = [];
  try {
    await uploadFilesViaApi(
      [
        bigFile("a.mp4", 10 * 1024 * 1024, "video/mp4"),
        bigFile("b.mp4", 10 * 1024 * 1024, "video/mp4"),
      ],
      (percent) => seen.push(percent)
    );
    assert.ok(seen.some((percent) => percent > 0 && percent < 100));
    assert.equal(seen[seen.length - 1], 100);
  } finally {
    axios.post = originalPost;
    xhr.restore();
  }
});

test("a browser-renderable type is stored as an opaque download", () => {
  assert.equal(directUploadContentType("text/html"), "application/octet-stream");
  assert.equal(
    directUploadContentType("image/svg+xml"),
    "application/octet-stream"
  );
  assert.equal(directUploadContentType("video/mp4; codecs=avc1"), "video/mp4");
  assert.equal(directUploadContentType(null), "application/octet-stream");
  assert.equal(directUploadContentType("not a mime"), "application/octet-stream");
});

test("the object key segment cannot escape the attachments prefix", () => {
  assert.equal(safeDirectUploadNameSegment("../../etc/passwd"), "etc_passwd");
  assert.equal(safeDirectUploadNameSegment("a b?c#d.mp4"), "a_b_c_d.mp4");
  assert.equal(safeDirectUploadNameSegment("...."), "file");
});

test("the direct-upload ceiling is far above the serverless body limit", () => {
  assert.ok(DIRECT_UPLOAD_MAX_FILE_BYTES > 100 * 1024 * 1024);
  assert.equal(getDirectUploadSizeError([{ name: "v.mp4", size: 150 * 1024 * 1024 }]), null);
  assert.match(
    getDirectUploadSizeError([
      { name: "v.mp4", size: DIRECT_UPLOAD_MAX_FILE_BYTES + 1 },
    ]),
    /v\.mp4/
  );
});

test("the presign route rejects input the client should never send", () => {
  const { parseRequestedFiles } = uploadUrlRoute;
  assert.throws(() => parseRequestedFiles({ files: [] }), /No files/);
  assert.throws(
    () => parseRequestedFiles({ files: [{ name: "", size: 1 }] }),
    /needs a name/
  );
  assert.throws(
    () => parseRequestedFiles({ files: [{ name: "a.mp4", size: -1 }] }),
    /Invalid size/
  );
  assert.throws(
    () =>
      parseRequestedFiles({
        files: [{ name: "a.mp4", size: DIRECT_UPLOAD_MAX_FILE_BYTES + 1 }],
      }),
    /must be under/
  );
  assert.throws(
    () =>
      parseRequestedFiles({
        files: Array.from({ length: 11 }, (_, i) => ({
          name: `f${i}.png`,
          size: 10,
        })),
      }),
    /maximum of 10/
  );
  assert.deepEqual(parseRequestedFiles({ files: [{ name: " a.mp4 ", size: 5 }] }), [
    { name: "a.mp4", size: 5, type: null },
  ]);
});

// HTPR-5524 review: the signed PUT must not trust the size the client declared
// in JSON, or a ticket for a tiny file could carry an unbounded body.
test("the signed PUT is bound to one exact byte length", async () => {
  process.env.S3_UPLOAD_KEY = process.env.S3_UPLOAD_KEY || "test-key";
  process.env.S3_UPLOAD_SECRET = process.env.S3_UPLOAD_SECRET || "test-secret";
  const url = await uploadUrlRoute.signUpload(
    "tasks/attachments/1_demo.mp4",
    "video/mp4",
    120 * 1024 * 1024
  );
  const signed = decodeURIComponent(
    new URL(url).searchParams.get("X-Amz-SignedHeaders")
  );
  // content-length inside the signature is what makes storage reject a body of
  // any other size, so a ticket for a small file cannot carry a large one.
  assert.ok(signed.split(";").includes("content-length"), signed);
  assert.ok(signed.split(";").includes("content-type"), signed);
});

test("finalize only accepts keys inside the attachments prefix", () => {
  const { parseKeys } = finalizeRoute;
  assert.deepEqual(parseKeys(["tasks/attachments/1_ok.png"], "keep"), [
    "tasks/attachments/1_ok.png",
  ]);
  assert.deepEqual(parseKeys(undefined, "keep"), []);
  assert.throws(() => parseKeys(["secrets/env"], "keep"), /Invalid/);
  // A key the caller was never issued is refused even though it fits the prefix.
  assert.throws(
    () =>
      parseKeys(["tasks/attachments/1_someone-else.png"], "keep", [
        "tasks/attachments/1_mine.png",
      ]),
    /Invalid/
  );
  assert.throws(
    () => parseKeys(["tasks/attachments/../../secrets/env"], "keep"),
    /Invalid/
  );
  assert.throws(() => parseKeys("nope", "keep"), /Invalid/);
});

// HTPR-5524 review: a partial failure must not re-upload the file that already
// reached storage, which would orphan the first object and pay for it twice.
test("only the failed file falls back, the successful one is not sent again", async () => {
  const originalPost = axios.post;
  const bufferedBodies = [];
  const finalizeBodies = [];
  axios.post = async (url, body) => {
    if (url === "/api/tasks/uploadUrl") {
      return { data: { uploads: [ticketFor("good.png"), ticketFor("bad.png")], grant: "g" } };
    }
    if (url === "/api/tasks/uploadFinalize") {
      finalizeBodies.push(body);
      return { data: { success: true } };
    }
    bufferedBodies.push(body);
    return { data: { fileUrls: ["https://files.hypertask.app/x/bad.png"] } };
  };
  const xhr = stubXhr((request) => {
    if (request.url.includes("bad.png")) {
      request.onerror();
      return;
    }
    request.status = 200;
    request.onload();
  });
  try {
    const urls = await uploadFilesViaApi([
      tinyFile("good.png"),
      tinyFile("bad.png"),
    ]);
    assert.deepEqual(urls, [
      "https://files.hypertask.app/tasks/attachments/1_good.png",
      "https://files.hypertask.app/x/bad.png",
    ]);
    // One buffered retry, carrying one file: the successful direct upload is
    // reused rather than repeated.
    assert.equal(bufferedBodies.length, 1);
    assert.equal(bufferedBodies[0].getAll("files").length, 1);
    assert.equal(bufferedBodies[0].getAll("files")[0].name, "bad.png");
    // Only the object that really reached storage is verified server-side.
    assert.deepEqual(finalizeBodies, [
      {
        grant: "g",
        keep: ["tasks/attachments/1_good.png"],
        discard: ["tasks/attachments/1_bad.png"],
      },
    ]);
  } finally {
    axios.post = originalPost;
    xhr.restore();
  }
});

// HTPR-5524 review: a batch that fails outright must not leave the object that
// already uploaded sitting in public storage with nothing pointing at it.
test("a failed batch asks the server to delete what already uploaded", async () => {
  const originalPost = axios.post;
  const finalizeBodies = [];
  axios.post = async (url, body) => {
    if (url === "/api/tasks/uploadUrl") {
      return { data: { uploads: [ticketFor("good.png"), ticketFor("bad.png")], grant: "g" } };
    }
    finalizeBodies.push(body);
    return { data: { success: true } };
  };
  const xhr = stubXhr((request) => {
    if (request.url.includes("bad.png")) {
      // A real HTTP rejection, not a network failure: nothing to retry.
      request.status = 403;
      request.onload();
      return;
    }
    request.status = 200;
    request.onload();
  });
  try {
    await assert.rejects(
      () => uploadFilesViaApi([tinyFile("good.png"), tinyFile("bad.png")]),
      /Storage rejected/
    );
    assert.deepEqual(finalizeBodies, [
      { grant: "g", keep: [], discard: ["tasks/attachments/1_good.png"] },
    ]);
  } finally {
    axios.post = originalPost;
    xhr.restore();
  }
});

// HTPR-5524 review: finalization must be a capability handed back to the caller
// who was issued those keys, not a permission over the whole attachment prefix.
test("an upload grant only covers the keys it was minted for", () => {
  const grant = uploadGrant.signUploadGrant(
    { userId: 6, keys: ["tasks/attachments/1_ok.png"] },
    900
  );
  const verified = uploadGrant.verifyUploadGrant(grant);
  assert.equal(verified.userId, 6);
  assert.deepEqual(verified.keys, ["tasks/attachments/1_ok.png"]);

  assert.equal(uploadGrant.verifyUploadGrant(`${grant}x`), null);
  assert.equal(uploadGrant.verifyUploadGrant("not.a.grant"), null);
  assert.equal(uploadGrant.verifyUploadGrant(undefined), null);
  assert.equal(
    uploadGrant.verifyUploadGrant(
      uploadGrant.signUploadGrant({ userId: 6, keys: [] }, -1)
    ),
    null
  );
});
