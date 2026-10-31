const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/ai-image-ssrf-jiti-${++jitiEntryId}.cjs`),
    { interopDefault: true, alias: { "@": path.join(root, "src") } },
  );
  return jiti(path.join(root, relativePath));
}

const { assertSafeWebhookTarget, isPrivateIp } = loadTs(
  "src/lib/mcp/webhooks/ssrfGuard.ts",
);

test("cloud metadata and loopback addresses are rejected", async () => {
  assert.equal(isPrivateIp("169.254.169.254"), true);
  assert.equal(isPrivateIp("127.0.0.1"), true);
  assert.equal(isPrivateIp("10.0.0.5"), true);
  assert.equal(isPrivateIp("192.168.1.1"), true);
  assert.equal(isPrivateIp("172.16.0.1"), true);
  assert.equal(isPrivateIp("::1"), true);

  for (const url of [
    "http://169.254.169.254/latest/meta-data/",
    "https://169.254.169.254/latest/meta-data/",
    "https://127.0.0.1/admin",
    "https://localhost/admin",
    "https://redis.internal/keys",
    "https://db.local/",
  ]) {
    const verdict = await assertSafeWebhookTarget(url);
    assert.equal(verdict.ok, false, `${url} must be rejected`);
  }
});

test("plain http is rejected even for a public host", async () => {
  const verdict = await assertSafeWebhookTarget("http://example.com/a.png");
  assert.equal(verdict.ok, false);
});

test("a real public image host still passes", async () => {
  const verdict = await assertSafeWebhookTarget("https://hypertask.app/explorations/x.png");
  assert.equal(verdict.ok, true, `unexpectedly rejected: ${verdict.reason}`);
});

test("loadCurrentTaskImages filters URLs through the guard", () => {
  const source = fs.readFileSync(
    path.join(root, "src/app/api/ai/_lib/currentTaskContext.ts"),
    "utf8",
  );
  assert.ok(
    /assertSafeWebhookTarget/.test(source),
    "ticket image URLs must be checked before they are handed on to be fetched",
  );
  const guard = source.indexOf("assertSafeWebhookTarget(url)");
  const ret = source.indexOf("mimeType: mimeTypeForUrl(url)");
  assert.ok(guard !== -1 && guard < ret, "the guard must run before the URLs are returned");
});
