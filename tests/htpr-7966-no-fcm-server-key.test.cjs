const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("no legacy FCM server key is tracked in app code", () => {
  const result = spawnSync(
    "git",
    ["grep", "-n", "-F", "key=AAAA", "--", "src", "public"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 1, result.stdout);
});

test("the legacy FCM config file is gone", () => {
  assert.equal(fs.existsSync(path.join(root, "src/utils/api/fcmConfig.ts")), false);
});

test("push still sends through firebase-admin", () => {
  const source = fs.readFileSync(path.join(root, "src/utils/controllers/FCM/index.ts"), "utf8");
  assert.ok(source.includes("getMessaging(getFirebaseAdmin()).send(message)"));
  assert.equal(source.includes("fcm.googleapis.com/fcm/send"), false);
});
