const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const manifestPath = path.join(process.cwd(), "public/android-native/latest.json");
const releaseDirectory = path.join(process.cwd(), "public/android-native/releases");

test("Android native update manifest stays compatible and trusted", () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const apkUrl = new URL(manifest.apkUrl);

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(Number.isInteger(manifest.versionCode), true);
  assert.equal(manifest.versionCode > 0, true);
  assert.match(manifest.versionName, /^\d+\.\d+\.\d+$/);
  assert.equal(Number.isInteger(manifest.minimumSupportedVersionCode), true);
  assert.equal(manifest.minimumSupportedVersionCode > 0, true);
  assert.equal(apkUrl.protocol, "https:");
  // Owner policy HTPR-5532: APK binaries live in the public
  // hypertask-app-releases GitHub releases, never in this repo.
  assert.equal(
    apkUrl.hostname === "files.hypertask.app" ||
      (apkUrl.hostname === "github.com" &&
        /^\/valentinyeo\/hypertask-app-releases\/releases\/download\/android-native-v[^/]+\/[^/]+\.apk$/.test(
          apkUrl.pathname
        )),
    true
  );
  assert.equal(fs.existsSync(releaseDirectory), false);
  assert.match(apkUrl.pathname, /\.apk$/);
  assert.match(manifest.sha256, /^[a-f0-9]{64}$/);
  assert.equal(Number.isSafeInteger(manifest.sizeBytes), true);
  assert.equal(manifest.sizeBytes > 0, true);
  assert.equal(Array.isArray(manifest.releaseNotes), true);
  assert.equal(manifest.releaseNotes.length > 0, true);
  assert.equal(manifest.releaseNotes.every((note) => typeof note === "string" && note.trim()), true);
  assert.equal(Number.isNaN(Date.parse(manifest.publishedAt)), false);

  if (apkUrl.hostname === "app.hypertask.ai") {
    const apkPath = path.join(releaseDirectory, path.basename(apkUrl.pathname));
    const apk = fs.readFileSync(apkPath);

    assert.equal(apk.byteLength, manifest.sizeBytes);
    assert.equal(crypto.createHash("sha256").update(apk).digest("hex"), manifest.sha256);
  }
});
