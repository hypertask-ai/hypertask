const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

process.env.SESSION_SECRET ||= "task-attachment-receipt-test-secret";

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const grants = jiti(path.join(root, "src/lib/storage/uploadGrant.ts"));

const metadata = {
  userId: 6,
  key: "tasks/attachments/verified.txt",
  fileName: "Original name.txt",
  contentType: "text/plain",
  fileSize: 1234,
};

test("a task attachment receipt preserves server-signed metadata", () => {
  const receipt = grants.signTaskAttachmentLinkReceipt(metadata, 60);
  assert.deepEqual(grants.verifyTaskAttachmentLinkReceipt(receipt), metadata);
});

test("receipt metadata and token structure cannot be tampered with", () => {
  const receipt = grants.signTaskAttachmentLinkReceipt(metadata, 60);
  const [encoded, signature] = receipt.split(".");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString());
  payload.fileName = "forged.html";
  const forged = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`;

  assert.equal(grants.verifyTaskAttachmentLinkReceipt(forged), null);
  assert.equal(grants.verifyTaskAttachmentLinkReceipt(`${receipt}.extra`), null);
  assert.equal(grants.verifyTaskAttachmentLinkReceipt(`${receipt}x`), null);
  assert.equal(grants.verifyTaskAttachmentLinkReceipt("not.a.receipt"), null);
});

test("expired or malformed task attachment receipts are rejected", () => {
  assert.equal(
    grants.verifyTaskAttachmentLinkReceipt(
      grants.signTaskAttachmentLinkReceipt(metadata, -1),
    ),
    null,
  );
  assert.equal(
    grants.verifyTaskAttachmentLinkReceipt(
      grants.signTaskAttachmentLinkReceipt({ ...metadata, fileSize: -1 }, 60),
    ),
    null,
  );
});

test("only upload grants minted for task linking carry trusted file metadata", () => {
  const key = "tasks/attachments/verified.txt";
  const ordinary = grants.signUploadGrant({ userId: 6, keys: [key] }, 60);
  assert.equal(grants.verifyUploadGrant(ordinary).taskLinkFiles, undefined);

  const taskLink = grants.signUploadGrant(
    {
      userId: 6,
      keys: [key],
      taskLinkFiles: [
        {
          key,
          fileName: "Original name.txt",
          contentType: "text/plain",
        },
      ],
    },
    60,
  );
  assert.deepEqual(grants.verifyUploadGrant(taskLink).taskLinkFiles, [
    {
      key,
      fileName: "Original name.txt",
      contentType: "text/plain",
    },
  ]);

  const mismatched = grants.signUploadGrant(
    {
      userId: 6,
      keys: [key],
      taskLinkFiles: [
        {
          key: "tasks/attachments/someone-elses.txt",
          fileName: "forged.txt",
          contentType: "text/plain",
        },
      ],
    },
    60,
  );
  assert.equal(grants.verifyUploadGrant(mismatched), null);
});
