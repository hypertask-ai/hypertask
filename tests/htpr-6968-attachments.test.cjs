const test = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const { load } = require("./task-route-loader.cjs");
const { attachmentRoutes, attachmentLegacySources } = require("./htpr-6923-verify.cjs");
const direct = load("src/lib/storage/directUpload.ts", {});
const keys = ["tasks/attachments/one.txt", "tasks/attachments/two.txt", "tasks/attachments/three.txt"];
const clean = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value, (_key, item) => item instanceof Set ? [...item] : item));
class LinkError extends Error {
  constructor() { super("Forbidden"); this.status = 403; }
}
const defaults = {
  uploadUrl: { files: [{ name: "one.txt", size: 4, type: "text/plain" }] },
  uploadFinalize: { grant: "grant", keep: [keys[0]], discard: [] },
  downloadAttachment: undefined,
};
function fixture(name, scenario, mode) {
  const effects = [], flags = [], loads = [];
  const session = scenario.noAuth ? null : scenario.noBetterAuth
    ? { userId: scenario.signedUser ?? 985, source: "legacy", needsBridge: true }
    : { userId: scenario.signedUser ?? 985, source: "better-auth" };
  const record = (label, value, fail = false) => (...args) => {
    effects.push([label, ...clean(args)]);
    if (fail) throw new Error(label + " unavailable");
    return typeof value === "function" ? value(...args) : value;
  };
  const receipt = { userId: scenario.otherUser ? 2343 : 985, key: keys[0], fileName: "one.txt", contentType: "text/plain", fileSize: 4 };
  const grant = { userId: scenario.otherUser ? 2343 : 985, keys, ...(scenario.taskLinkFiles ? { taskLinkFiles: scenario.taskLinkFiles } : {}) };
  const mocks = {
    "@/lib/auth/getSessionUser": { getSessionUser: async () => { if (scenario.authThrows) throw new Error("Auth unavailable"); return session; } },
    "@/lib/auth/session": { SESSION_COOKIE: "ht_session", verifySession: token => {
      effects.push(["signed-session", token]);
      return scenario.noAuth || scenario.noSigned ? null : { id: scenario.signedUser ?? 985 };
    } },
    "@/lib/flags/keys": { HTPR_6923_APP_ROUTER_WRITES_FLAG: "htpr-6923-app-router-writes" },
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
      if (key === "htpr-6923-app-router-writes") {
        flags.push([key, userId]);
        if (mode === "outage") throw new Error("Flag unavailable");
        return mode === true;
      }
      effects.push(["upload-feature", key, userId]);
      if (scenario.uploadFlagThrows) throw new Error("Upload flag unavailable");
      return !scenario.uploadFlagOff;
    } },
    "@/lib/storage/directUpload": direct,
    "@/lib/storage/hypertasksS3": {
      HYPERTASKS_S3_BUCKET: "bucket",
      getHypertasksPresignClient: () => "presign-client",
      getHypertasksStoragePublicUrl: key => `https://files.hypertask.app/${key}`,
      parseHypertasksStorageKeyFromUrl: url => url.startsWith("https://files.hypertask.app/") ? url.slice("https://files.hypertask.app/".length) : null,
      getHypertasksS3Client: () => {
        if (scenario.s3FactoryThrows) throw new Error("S3 client unavailable");
        return ({
        headObject: ({ Key, ...rest }) => ({ promise: async () => {
          effects.push(["head", { Key, ...rest }]);
          if (scenario.unreadable) throw new Error("Missing object");
          return { ContentLength: scenario.storedSizes?.[keys.indexOf(Key)] ?? 4 };
        } }),
        deleteObject: args => ({ promise: async () => record("delete", undefined, scenario.deleteThrows)(args) }),
        getSignedUrl: record("download-sign", "https://storage.invalid/signed-download", scenario.storageThrows),
      }); },
    },
    "@aws-sdk/client-s3": { PutObjectCommand: class { constructor(input) { this.input = input; } } },
    "@aws-sdk/s3-request-presigner": { getSignedUrl: async (...args) => record("upload-sign", `https://storage.invalid/signed-put/${args[1].input.Key}`, scenario.storageThrows)(...args) },
    "node:crypto": { randomUUID: () => "fixed-uuid" },
    "@/lib/media/heicPreview": { HEIC_PREVIEW_CONTENT_TYPE: "image/jpeg", heicPreviewKey: key => key + ".preview.jpg", isHeicPreviewUrl: key => key.endsWith(".preview.jpg") },
    "@/lib/storage/uploadTaskAttachmentToS3": { TASK_ATTACHMENT_PREFIX: "tasks/attachments" },
    "@/lib/storage/uploadGrant": {
      signUploadGrant: record("grant-sign", "signed-grant"),
      verifyUploadGrant: token => { effects.push(["grant-verify", token]); return token === "grant" ? grant : null; },
      signTaskAttachmentLinkReceipt: record("receipt-sign", "signed-receipt"),
      TASK_ATTACHMENT_LINK_RECEIPT_TTL_SECONDS: 3600,
      verifyTaskAttachmentLinkReceipt: token => { effects.push(["receipt-verify", token]); return token === "receipt" ? receipt : null; },
    },
    "@/lib/storage/linkTaskAttachment": {
      TaskAttachmentLinkError: LinkError,
      linkTaskAttachment: async (...args) => { effects.push(["link", ...clean(args)]); if (scenario.denied) throw new LinkError(); if (scenario.linkThrows) throw new Error("Link unavailable"); return { id: 5, fileSource: `https://files.hypertask.app/${keys[0]}` }; },
      discardTaskAttachment: async (...args) => { effects.push(["discard", ...clean(args)]); if (scenario.denied) throw new LinkError(); if (scenario.linkThrows) throw new Error("Discard unavailable"); return !scenario.alreadyLinked; },
    },
    "@/lib/realtime/server": { broadcastTaskChange: async (...args) => record("realtime", undefined, scenario.realtimeThrows)(...args) },
    "@/lib/agents/publicAgent": {},
    "@/lib/cycles": {},
    "@/lib/agents/visibility": {},
    "@/utils/controllers/notifications/visibleInboxScope": {},
    "@/lib/prisma": { default: {
      attachment: { findMany: async (...args) => record("attachment-access", scenario.attachment ? [{ fileSource: `https://files.hypertask.app/${keys[0]}`, ...scenario.attachment }] : [], scenario.lookupThrows)(...args) },
      project: { findFirst: async (...args) => record("project-access", scenario.denied ? null : { id: 15 })(...args) },
      description: { findMany: async (...args) => record("description-access", [])(...args) },
      comment: { findMany: async (...args) => record("comment-access", [])(...args) },
      page: { findMany: async (...args) => record("page-access", [])(...args) },
      chatSession: { findFirst: async (...args) => record("chat-session-access", null)(...args) },
    } },
  };
  if (name === "downloadAttachment") {
    mocks["@/utils/controllers/tasks/getAccessibleAttachmentKey"] = load("src/utils/controllers/tasks/getAccessibleAttachmentKey.ts", mocks);
  }
  const { module: operation, method } = attachmentRoutes[name];
  const web = load(`src/lib/api/task-writes/${operation}.ts`, mocks)[method];
  mocks[`@/lib/api/task-writes/${operation}`] = { get [method]() { loads.push(operation); if (scenario.loadThrows) throw new Error("Route load unavailable"); return web; } };
  const source = attachmentLegacySources()[name];
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(specifier => {
    assert.ok(Object.hasOwn(mocks, specifier), `Unexpected original dependency: ${specifier}`);
    const mock = mocks[specifier]; return Object.hasOwn(mock, "default") ? { __esModule: true, ...mock } : mock;
  }, mod, mod.exports);
  return { legacy: mod.exports.default, current: load(`src/pages/api/tasks/${name}.ts`, mocks).default, web, effects, flags, loads };
}
async function invoke(fx, name, scenario, target, method = attachmentRoutes[name].method) {
  const body = Object.hasOwn(scenario, "body") ? scenario.body : defaults[name];
  const query = scenario.query ?? { fileName: "one café.txt", fileSource: `https://files.hypertask.app/${keys[0]}` };
  const headers = {}, cookie = scenario.cookie ?? "ht_session=user-token";
  let result;
  const now = Date.now, error = console.error, warn = console.warn;
  Date.now = () => 1770000000000; console.error = () => {}; console.warn = () => {};
  try {
    if (target === "web") {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
      const request = new Request(`https://example.invalid/api/tasks/${name}?${params}`, { method, headers: { cookie } });
      const response = await fx.web({ url: request.url, headers: request.headers, json: async () => body });
      response.headers.forEach((value, key) => { if (key !== "content-type") headers[key] = value; });
      const text = await response.text();
      const json = response.headers.get("content-type")?.includes("application/json");
      result = { status: response.status, body: json ? JSON.parse(text) : text, transport: json ? "json" : "send", headers };
    } else {
      const res = { setHeader: (key, value) => { headers[key.toLowerCase()] = value; }, status: status => ({
        json: value => { result = { status, body: clean(value), transport: "json", headers }; return result; },
        send: value => { result = { status, body: value, transport: "send", headers }; return result; },
      }) };
      await fx[target]({ method, body, query, headers: { cookie }, cookies: { ht_session: "user-token" } }, res);
    }
  } catch (error) { result = { throws: String(error) }; }
  finally { Date.now = now; console.error = error; console.warn = warn; }
  return result;
}
const files = (sizes) => ({ files: sizes.map((size, i) => ({ name: `file${i}.txt`, size, type: "text/plain" })) });
const cases = {
  uploadUrl: [
    ["success", {}], ["forged body actor ignored", { body: { ...defaults.uploadUrl, userId: 6 } }], ["signed actor", { signedUser: 2343 }], ["missing files", { body: {}, status: 400 }], ["null body", { body: null, status: 400 }],
    ["missing name", { body: { files: [{ size: 4 }] }, status: 400 }], ["255-byte name", { body: { files: [{ name: "é".repeat(128), size: 4 }] }, status: 400 }],
    ["negative size", { body: files([-1]), status: 400 }], ["unsafe size", { body: files([Number.MAX_SAFE_INTEGER + 1]), status: 400 }],
    ["zero-byte file", { body: files([0]) }], ["exact file ceiling", { body: files([direct.DIRECT_UPLOAD_MAX_FILE_BYTES]) }],
    ["file too large", { body: files([direct.DIRECT_UPLOAD_MAX_FILE_BYTES + 1]), status: 413 }],
    ["batch too large", { body: files(Array(3).fill(direct.DIRECT_UPLOAD_MAX_FILE_BYTES)), status: 413 }],
    ["file count", { body: files(Array(11).fill(4)), status: 400 }], ["array ceiling", { body: files(Array(21).fill(4)), status: 400 }],
    ["unsafe MIME becomes binary", { body: { files: [{ name: "page.html", size: 4, type: "text/html" }] } }],
    ["HEIC preview", { body: { files: [{ name: "photo.heic", size: 4, type: "image/heic" }, { name: "preview.jpg", size: 2, type: "text/html", previewOfIndex: 0 }] } }],
    ["forward preview", { body: { files: [{ name: "p.jpg", size: 4, previewOfIndex: 1 }] }, status: 400 }],
    ["duplicate preview", { body: { files: [{ name: "p.heic", size: 4 }, { name: "p.jpg", size: 2, previewOfIndex: 0 }, { name: "p2.jpg", size: 2, previewOfIndex: 0 }] }, status: 400 }],
    ["invalid purpose", { body: { ...defaults.uploadUrl, purpose: "bad" }, status: 400 }],
    ["task-link grant", { body: { ...defaults.uploadUrl, purpose: "task-attachment-link" } }],
    ["purpose permission denied", { body: { ...defaults.uploadUrl, purpose: "task-attachment-link" }, uploadFlagOff: true, status: 403 }],
    ["purpose flag outage", { body: { ...defaults.uploadUrl, purpose: "task-attachment-link" }, uploadFlagThrows: true, status: 500 }],
    ["sign failure", { storageThrows: true, status: 500 }],
  ],
  uploadFinalize: [
    ["success", {}], ["null body", { body: null, status: 403 }], ["invalid grant", { body: {}, status: 403 }],
    ["other user's grant", { otherUser: true, status: 403 }],
    ["ungranted key", { body: { grant: "grant", keep: ["tasks/attachments/unknown.txt"] }, status: 400 }],
    ["traversal", { body: { grant: "grant", keep: ["tasks/attachments/../one.txt"] }, status: 400 }],
    ["invalid key shape", { body: { grant: "grant", keep: "bad" }, status: 400 }],
    ["S3 creation failure propagates", { s3FactoryThrows: true }],
    ["discard then verify", { body: { grant: "grant", keep: [keys[0]], discard: [keys[1]] } }],
    ["best-effort deletion", { body: { grant: "grant", discard: [keys[1]] }, deleteThrows: true }],
    ["unreadable object", { unreadable: true, status: 409 }],
    ["file too large and deleted", { storedSizes: [direct.DIRECT_UPLOAD_MAX_FILE_BYTES + 1], status: 413 }],
    ["exact file ceiling", { storedSizes: [direct.DIRECT_UPLOAD_MAX_FILE_BYTES] }],
    ["batch too large deletes all", { body: { grant: "grant", keep: keys }, storedSizes: Array(3).fill(direct.DIRECT_UPLOAD_MAX_FILE_BYTES), status: 413 }],
    ["receipts lack grant metadata", { body: { ...defaults.uploadFinalize, issueTaskLinkReceipts: true }, status: 403 }],
    ["receipt issuance", { body: { ...defaults.uploadFinalize, issueTaskLinkReceipts: true }, taskLinkFiles: [{ key: keys[0], fileName: "one.txt", contentType: "text/plain" }] }],
    ["receipt metadata incomplete", { body: { ...defaults.uploadFinalize, issueTaskLinkReceipts: true }, taskLinkFiles: [], status: 400 }],
    ["link success", { body: { action: "link-task-attachment", taskId: 42, receipt: "receipt" } }],
    ["link realtime best effort", { body: { action: "link-task-attachment", taskId: 42, receipt: "receipt" }, realtimeThrows: true }],
    ["link permission denied", { body: { action: "link-task-attachment", taskId: 42, receipt: "receipt" }, denied: true, status: 403 }],
    ["link other user", { body: { action: "link-task-attachment", taskId: 42, receipt: "receipt" }, otherUser: true, status: 403 }],
    ["link invalid task", { body: { action: "link-task-attachment", taskId: 0, receipt: "receipt" }, status: 400 }],
    ["link flag off", { body: { action: "link-task-attachment", taskId: 42, receipt: "receipt" }, uploadFlagOff: true, status: 403 }],
    ["link flag outage", { body: { action: "link-task-attachment", taskId: 42, receipt: "receipt" }, uploadFlagThrows: true, status: 500 }],
    ["link failure after dispatch", { body: { action: "link-task-attachment", taskId: 42, receipt: "receipt" }, linkThrows: true, status: 500 }],
    ["discard success", { body: { action: "discard-task-attachment", receipt: "receipt" } }],
    ["discard linked stays", { body: { action: "discard-task-attachment", receipt: "receipt" }, alreadyLinked: true }],
    ["discard invalid receipt", { body: { action: "discard-task-attachment", receipt: "bad" }, status: 400 }],
    ["discard other user", { body: { action: "discard-task-attachment", receipt: "receipt" }, otherUser: true, status: 403 }],
    ["discard denied", { body: { action: "discard-task-attachment", receipt: "receipt" }, denied: true, status: 403 }],
  ],
  downloadAttachment: [
    ["S3 creation failure propagates", { s3FactoryThrows: true }],
    ["unknown legacy file fails closed", { status: 404 }], ["missing name", { query: { fileSource: "url" }, status: 400 }],
    ["missing source", { query: { fileName: "name" }, status: 400 }],
    ["task membership", { attachment: { task: { projectId: 15 } } }],
    ["description membership", { attachment: { description: { task: { projectId: 15 } } } }],
    ["comment membership", { attachment: { comment: { task: { projectId: 15 } } } }],
    ["project denied", { attachment: { task: { projectId: 15 } }, denied: true, status: 404 }],
    ["chat owner", { attachment: { chatMessage: { session: { userId: 985 } } } }],
    ["chat denied", { attachment: { chatMessage: { session: { userId: 2343 } } }, status: 404 }],
    ["unresolved attachment fails closed", { attachment: {}, status: 404 }],
    ["unknown external URL", { query: { fileName: "x.txt", fileSource: "https://unknown.invalid/x" }, status: 404 }],
    ["lookup outage", { lookupThrows: true, status: 500 }], ["sign outage", { attachment: { task: { projectId: 15 } }, storageThrows: true, status: 500 }],
    ["query arrays and encoded filename", { attachment: { task: { projectId: 15 } }, query: { fileName: ["a.txt", "b café.txt"], fileSource: [`https://files.hypertask.app/${keys[0]}`] } }],
  ],
};
for (const name of Object.keys(attachmentRoutes)) {
  const authCases = [["unauthenticated", { noAuth: true, status: 401 }], ["Better Auth only", { noSigned: true }], ["legacy only", { noBetterAuth: true }], ["auth resolver throws", { noSigned: true, authThrows: true }]];
  for (const [label, scenario] of [...cases[name], ...authCases]) test(`${name}: ${label} matches old, Off, outage, On and Web`, async () => {
    const baseline = fixture(name, scenario, false);
    const expected = await invoke(baseline, name, scenario, "legacy");
    if (scenario.status) assert.equal(expected.status, scenario.status);
    for (const mode of [false, "outage", true, "web"]) {
      const fx = fixture(name, scenario, mode);
      assert.deepEqual(await invoke(fx, name, scenario, mode === "web" ? "web" : "current"), expected, `${name} ${label} ${mode}`);
      assert.deepEqual(fx.effects, baseline.effects, `${name} ${label} side effects ${mode}`);
      assert.equal(fx.loads.length, mode === true && !scenario.noAuth && !scenario.authThrows ? 1 : 0);
      if (fx.flags.length) assert.deepEqual(fx.flags, [["htpr-6923-app-router-writes", scenario.signedUser ?? 985]], "only session identity selects migration flag");
    }
  });
  for (const noAuth of [false, true]) test(`${name}: other method bypasses flag preflight; unauthenticated=${noAuth}`, async () => {
    const scenario = { noAuth };
    const old = fixture(name, scenario, false), current = fixture(name, scenario, true);
    const method = name === "downloadAttachment" ? "POST" : "GET";
    assert.deepEqual(await invoke(current, name, scenario, "current", method), await invoke(old, name, scenario, "legacy", method));
    assert.deepEqual(current.flags, []); assert.deepEqual(current.loads, []);
  });
  test(`${name}: loading failure never retries legacy`, async () => {
    const fx = fixture(name, { loadThrows: true }, true);
    assert.deepEqual(await invoke(fx, name, { loadThrows: true }, "current"), { throws: "Error: Route load unavailable" });
    assert.equal(fx.loads.length, 1);
    assert.deepEqual(fx.effects, [], "legacy auth/storage must not execute after dispatch");
  });
}
test("signed upload binds exact byte length, MIME, expiry and grant user", async () => {
  const scenario = {};
  const fx = fixture("uploadUrl", scenario, true);
  const result = await invoke(fx, "uploadUrl", scenario, "current");
  assert.equal(result.status, 200);
  const signature = fx.effects.find(([label]) => label === "upload-sign");
  assert.deepEqual(signature.slice(1), ["presign-client", { input: { Bucket: "bucket", Key: "tasks/attachments/1770000000000_fixed-uuid_one.txt", ContentType: "text/plain", ContentLength: 4 } }, { expiresIn: 900, signableHeaders: ["content-length", "content-type"] }]);
  assert.equal(fx.effects.find(([label]) => label === "grant-sign")[1].userId, 985);
});
test("download preserves 60-second disposition and no-cache headers", async () => {
  const scenario = { attachment: { task: { projectId: 15 } } };
  const fx = fixture("downloadAttachment", scenario, true);
  const result = await invoke(fx, "downloadAttachment", scenario, "current");
  assert.deepEqual(result.headers, { "cache-control": "no-store", pragma: "no-cache", expires: "0" });
  assert.deepEqual(fx.effects.find(([label]) => label === "download-sign"), ["download-sign", "getObject", { Bucket: "bucket", Key: keys[0], Expires: 60, ResponseContentDisposition: "attachment; filename=one%20caf%C3%A9.txt" }]);
});
process.on("exit", (code) => { if (!code) console.log("Attachment contract checks passed"); });
