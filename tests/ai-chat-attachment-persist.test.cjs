const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

// The helper reads storage config at import time, so pin it before loading the module.
process.env.R2_ENDPOINT = "https://example-r2.invalid";
process.env.R2_UPLOAD_KEY = "test-key";
process.env.R2_UPLOAD_SECRET = "test-secret";
process.env.R2_UPLOAD_BUCKET = "hypertasks-uploads";
process.env.R2_PUBLIC_BASE_URL = "https://files.hypertask.app";

let jitiEntryId = 0;
function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/ai-chat-attachment-jiti-entry-${++jitiEntryId}.cjs`),
    { interopDefault: true, alias: { "@": path.join(root, "src") } }
  );
  return jiti(path.join(root, relativePath));
}

const { resolveOwnAiChatAttachmentKey } = loadTs(
  "src/lib/storage/uploadTaskAttachmentToS3.ts"
);

const BASE = "https://files.hypertask.app";
const SESSION = "sess-abc";
const OWN = `${BASE}/ai-chat/attachments/${SESSION}/1785_shot.png`;

// WHY: AI chat attachments hit the same CORS wall as the task writer (HTPR-4735). The file
// is uploaded the moment it is pasted, and files.hypertask.app serves no CORS header, so
// the browser can never read it back into base64. Sending the URL is the only option, which
// means the persist route now has to trust a client-supplied URL. These tests pin the check
// that makes that safe. Ref HTPR-4777.

test("this session's own uploaded attachment resolves to its storage key", () => {
  assert.equal(
    resolveOwnAiChatAttachmentKey(OWN, SESSION),
    `ai-chat/attachments/${SESSION}/1785_shot.png`
  );
});

// Deleting a chat session deletes the underlying object for every attachment row it holds,
// so anything accepted here can later be destroyed by whoever owns that session. Accepting
// another user's task attachment would turn "delete my chat" into "delete their file".
test("a file belonging to anyone else is refused", () => {
  const foreign = [
    [`${BASE}/tasks/attachments/1785_victim.png`, "someone else's task attachment"],
    [`${BASE}/ai-chat/attachments/other-session/1785_shot.png`, "another chat session"],
    [`${BASE}/ai-chat/attachments/${SESSION}/../other-session/x.png`, "path traversal"],
    [`${BASE}/ai-chat/attachments/${SESSION}/nested/x.png`, "a nested key"],
    [`${BASE}/ai-chat/attachments/${SESSION}`, "the folder itself"],
    // url.pathname leaves %2F encoded, so these look like a single segment until decoded.
    [`${BASE}/ai-chat/attachments/${SESSION}/a%2F..%2Fb.png`, "encoded separator"],
    [`${BASE}/ai-chat/attachments/${SESSION}/a%5Cb.png`, "encoded backslash"],
    [`${BASE}/ai-chat/attachments/${SESSION}/%2E%2E%2Fx.png`, "encoded traversal"],
  ];
  for (const [url, why] of foreign) {
    assert.equal(resolveOwnAiChatAttachmentKey(url, SESSION), null, why);
  }
});

// The previous revision reused a broader helper that fell back to accepting any hostname
// ending in amazonaws.com or cloudfront.net, so an attacker-controlled host could be
// persisted and later rendered and fed to the model.
test("a foreign host is refused even when the path looks right", () => {
  const KEY = `/ai-chat/attachments/${SESSION}/1785_shot.png`;
  for (const host of [
    "https://evil.example.com",
    "https://notamazonaws.com",
    "https://attacker.s3.amazonaws.com",
    "https://x.cloudfront.net",
    "http://files.hypertask.app",
    "https://files.hypertask.app.evil.com",
  ]) {
    assert.equal(
      resolveOwnAiChatAttachmentKey(`${host}${KEY}`, SESSION),
      null,
      `${host} is not our storage origin`
    );
  }
});

// R2 and S3 key off the decoded path while the URL carries it percent-encoded, so without
// decoding, a file with a non-ASCII name misses its own object.
test("a percent-encoded file name resolves to the decoded key", () => {
  assert.equal(
    resolveOwnAiChatAttachmentKey(
      `${BASE}/ai-chat/attachments/${SESSION}/1785_r%C3%A9sum%C3%A9.png`,
      SESSION
    ),
    `ai-chat/attachments/${SESSION}/1785_résumé.png`
  );
});

test("junk input returns null rather than throwing", () => {
  for (const bad of ["", "not-a-url", "javascript:alert(1)", "data:image/png;base64,AAAA"]) {
    assert.equal(resolveOwnAiChatAttachmentKey(bad, SESSION), null, bad || "(empty)");
  }
});

// Source-level guards for the two wiring mistakes that would reintroduce the bug.
const ROUTE = fs.readFileSync(
  path.join(root, "src/app/api/ai-chat/add-message/route.ts"),
  "utf8"
);

test("the hosted-URL branch runs before the data-URL parse, which throws on https", () => {
  const authorise = ROUTE.indexOf("resolveOwnAiChatAttachmentKey(source, sessionId)");
  const parse = ROUTE.indexOf("parseDataUrlToBuffer(source)");
  assert.ok(authorise > 0, "route must authorise the URL");
  assert.ok(parse > 0, "data-URL path must still exist for genuinely inline files");
  assert.ok(authorise < parse, "authorising second would throw before it ever ran");
});

// A HEAD can fail for transient or permission reasons. Treating that as "not allowed" would
// drop the user's own message while the assistant reply persists separately, leaving a
// reply with no question.
test("a failed size lookup does not reject the attachment", () => {
  const branch = ROUTE.slice(
    ROUTE.indexOf("const ownKey ="),
    ROUTE.indexOf("const { mimeType: parsedMimeType")
  );
  assert.ok(branch.length > 0, "hosted-URL branch not found");
  assert.match(
    branch,
    /fileSize:\s*String\(existingSize\s*\?\?\s*0\)/,
    "size must degrade to 0, not gate the attachment"
  );
  assert.doesNotMatch(
    branch,
    /uploadAiChatAttachmentToS3/,
    "the file is already in the bucket; re-uploading wastes a round trip"
  );
});

test("the chat client sends the hosted URL, never a re-fetch of the file", () => {
  const source = fs.readFileSync(
    path.join(root, "src/hooks/MultiPages/AIChat/useAiChat.ts"),
    "utf8"
  );
  const fromBranch = source.slice(source.indexOf('url.includes("ai-chat/attachments")'));
  const branch = fromBranch.slice(0, fromBranch.indexOf("} else"));
  assert.ok(branch.length > 0, "attachment branch not found");

  assert.match(
    branch,
    /getFileTypeFromUrl\(\s*url\s*,\s*IMAGE_FALLBACK_MIME\s*\)/,
    "type must come from the file name, and an img-tag URL must stay an image type"
  );
  assert.doesNotMatch(
    branch,
    /\b(blobToBase64|fetch)\s*\(/,
    "re-fetching the attachment is exactly what CORS blocks"
  );
  assert.match(branch, /^\s*url,\s*$/m, "must forward the hosted URL itself");
});
