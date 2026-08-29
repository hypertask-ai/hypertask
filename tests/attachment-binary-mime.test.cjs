const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const { isAllowedMime } = jiti(
  path.join(root, "src/lib/mcp/attachments/constants.ts")
);
const { bufferMatchesDeclaredMime } = jiti(
  path.join(root, "src/lib/mcp/attachments/magicBytes.ts")
);

// Build artifacts have to be attachable from the CLI/MCP, the way the web UI
// already allows them (HTPR-4577).
test("binary build artifacts are accepted", () => {
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
  for (const mime of [
    "application/zip",
    "application/x-zip-compressed",
    "application/vnd.android.package-archive",
  ]) {
    assert.ok(isAllowedMime(mime), `${mime} should be allowed`);
    assert.ok(bufferMatchesDeclaredMime(zip, mime), `${mime} should match a zip header`);
  }

  const gzip = Buffer.from([0x1f, 0x8b, 0x08, 0x00]);
  assert.ok(isAllowedMime("application/gzip"));
  assert.ok(bufferMatchesDeclaredMime(gzip, "application/gzip"));

  assert.ok(isAllowedMime("application/octet-stream"));
  assert.ok(
    bufferMatchesDeclaredMime(Buffer.from([0x00, 0x01, 0x02]), "application/octet-stream"),
    "octet-stream is unknown bytes by definition, nothing to match against"
  );
});

test("a zip declared as one is still checked against its header", () => {
  assert.equal(
    bufferMatchesDeclaredMime(Buffer.from("not a zip at all"), "application/zip"),
    false
  );
});

// The reason the whitelist exists: these render in the browser instead of
// downloading, so they stay out.
test("browser-renderable types remain rejected", () => {
  assert.equal(isAllowedMime("text/html"), false);
  assert.equal(isAllowedMime("image/svg+xml"), false);
  assert.equal(isAllowedMime("application/xhtml+xml"), false);
});

test("existing types still behave", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(isAllowedMime("image/png") && bufferMatchesDeclaredMime(png, "image/png"));
  assert.equal(bufferMatchesDeclaredMime(Buffer.from("hello"), "image/png"), false);
  assert.ok(bufferMatchesDeclaredMime(Buffer.from('{"a":1}'), "application/json"));
  assert.equal(bufferMatchesDeclaredMime(Buffer.from("{nope"), "application/json"), false);
});
