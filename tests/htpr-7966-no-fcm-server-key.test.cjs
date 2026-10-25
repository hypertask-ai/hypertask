const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("no legacy FCM server key is tracked in app code", () => {
  const result = spawnSync(
    "git",
    ["grep", "-n", "-E", "key=AAAA[A-Za-z0-9_-]{6,}:APA91", "--", "src", "public"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 1, result.stdout);
});

test("the legacy FCM config file is gone", () => {
  assert.equal(fs.existsSync(path.join(root, "src/utils/api/fcmConfig.ts")), false);
});

test("push still sends through firebase-admin", () => {
  const source = fs.readFileSync(path.join(root, "src/utils/controllers/FCM/index.ts"), "utf8");
  assert.match(source, /getMessaging\(getFirebaseAdmin\(\)\)\.send\(message\)/);
  assert.doesNotMatch(source, /fcm\.googleapis\.com\/fcm\/send/);
});
