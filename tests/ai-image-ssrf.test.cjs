// HTPR-4459: HyperAI collects <img src> URLs out of ticket descriptions and
// comments and hands them on to be fetched. Ticket HTML is attacker-controlled
// (the markdown image rule accepts any remote URL), so an unchecked URL means a
// fetch of whatever the author names — cloud metadata endpoints, internal
// services — with the result described back to them.
//
// Guarded with the same ssrfGuard we already use for webhook targets. This test
// pins the guard's behaviour on the shapes that matter for this attack; the
// wiring itself is asserted structurally below.
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
  // The classic target: AWS/GCP instance metadata.
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
  // Downgrades are a bypass route back to internal plaintext services.
  const verdict = await assertSafeWebhookTarget("http://example.com/a.png");
  assert.equal(verdict.ok, false);
});

test("a real public image host still passes", async () => {
  // The fix must not blind HyperAI to legitimate attachments.
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
  // The filter has to sit between collecting and returning, not be dead code.
  const guard = source.indexOf("assertSafeWebhookTarget(url)");
  const ret = source.indexOf("mimeType: mimeTypeForUrl(url)");
  assert.ok(guard !== -1 && guard < ret, "the guard must run before the URLs are returned");
});
