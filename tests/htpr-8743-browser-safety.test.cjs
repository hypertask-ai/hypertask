const test = require("node:test");
const assert = require("node:assert/strict");
const { getPathMatch } = require("next/dist/shared/lib/router/utils/path-match");
const config = require("../next.config.js");

async function headersFor(path) {
  const headers = {};
  for (const rule of await config.headers()) {
    if (!getPathMatch(rule.source)(path)) continue;
    for (const { key, value } of rule.headers) headers[key.toLowerCase()] = value;
  }
  return headers;
}

test("app, API, OAuth and files-private routes deny framing and stage script restrictions", async () => {
  for (const path of ["/", "/demo", "/login", "/project/15", "/oauth", "/oauth/approve", "/api/mcp/tasks", "/files-private", "/files-private/document.pdf"]) {
    const headers = await headersFor(path);
    assert.equal(headers["x-frame-options"], "DENY", path);
    assert.equal(headers["content-security-policy"], "frame-ancestors 'none'", path);
    assert.equal(headers["x-content-type-options"], "nosniff", path);
    assert.equal(headers["referrer-policy"], "strict-origin-when-cross-origin", path);
    assert.equal(
      headers["content-security-policy-report-only"],
      "script-src https://app.hypertask.ai/_next/static/ https://eu-assets.i.posthog.com https://cdn.usefathom.com; base-uri 'self'",
      path,
    );
  }
});

test("API CORS and WordPress handling stay unchanged", async () => {
  const headers = await headersFor("/api/mcp/tasks");
  assert.equal(headers["access-control-allow-credentials"], "true");
  assert.equal(headers["access-control-allow-origin"], "*");
  assert.equal(headers["access-control-allow-methods"], "GET,DELETE,PATCH,POST,PUT,OPTIONS");
  assert.equal(headers["access-control-allow-headers"], "Authorization, Idempotency-Key, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version");
  assert.equal((await headersFor("/api/auth/wordpress-signup"))["x-custom-cors"], "handled-by-middleware");
});

test("file embeds retain global protections and immutable caching", async () => {
  for (const path of ["/files", "/files/", "/files/report.html", "/files/doc.pdf"]) {
    const headers = await headersFor(path);
    assert.equal(headers["x-frame-options"], undefined, path);
    assert.equal(headers["content-security-policy"], undefined, path);
    assert.equal(headers["content-security-policy-report-only"], undefined, path);
    assert.equal(headers["x-content-type-options"], "nosniff", path);
    assert.equal(headers["referrer-policy"], "strict-origin-when-cross-origin", path);
    assert.equal(headers["cache-control"], "public, max-age=31536000, immutable", path);
  }
});

test("files proxy stays unchanged", async () => {
  assert.deepEqual((await config.rewrites()).find((rule) => rule.source === "/files/:path*"), {
    source: "/files/:path*",
    destination: "https://files.hypertask.app/:path*",
  });
});
