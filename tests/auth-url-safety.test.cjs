const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function loadTs(relativePath) {
  const jiti = require("jiti")(path.join(root, `tests/auth-jiti-entry-${++jitiEntryId}.cjs`), {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  });
  return jiti(path.join(root, relativePath));
}

test("parseSafeReturnTo only accepts approved same-site auth resume paths", () => {
  const { parseSafeReturnTo } = loadTs("src/lib/auth/safeReturnTo.ts");

  assert.equal(parseSafeReturnTo(null), null);
  assert.equal(parseSafeReturnTo(""), null);
  assert.equal(parseSafeReturnTo("/cli-auth"), "/cli-auth");
  assert.equal(
    parseSafeReturnTo(encodeURIComponent("/cli-auth/callback?code=abc")),
    "/cli-auth/callback?code=abc"
  );
  assert.equal(
    parseSafeReturnTo("/settings/slack/link?state=signed-state"),
    "/settings/slack/link?state=signed-state"
  );
  assert.equal(parseSafeReturnTo("/settings/slack/link/extra"), null);

  assert.equal(parseSafeReturnTo("/dashboard"), null);
  assert.equal(parseSafeReturnTo("https://evil.example/cli-auth"), null);
  assert.equal(parseSafeReturnTo("//evil.example/cli-auth"), null);
  assert.equal(parseSafeReturnTo("/cli-auth\\evil"), null);
  assert.equal(parseSafeReturnTo("/cli-auth%00evil"), null);
  assert.equal(parseSafeReturnTo("%E0%A4%A"), null);
});

test("parseSafePostCliRedirect rejects stale tutorial resumes while disabled", () => {
  const { parseSafePostCliRedirect } = loadTs("src/lib/auth/safeReturnTo.ts");

  assert.equal(parseSafePostCliRedirect(null), null);
  assert.equal(
    parseSafePostCliRedirect(
      encodeURIComponent("/interactive-onboarding/start?step=1")
    ),
    null
  );

  assert.equal(parseSafePostCliRedirect("/cli-auth"), null);
  assert.equal(
    parseSafePostCliRedirect("https://evil.example/interactive-onboarding/start"),
    null
  );
  assert.equal(
    parseSafePostCliRedirect("//evil.example/interactive-onboarding/start"),
    null
  );
  assert.equal(parseSafePostCliRedirect("/interactive-onboarding\\evil"), null);
  assert.equal(parseSafePostCliRedirect("/interactive-onboarding%00evil"), null);
});

test("getRequestBaseUrl accepts known auth hosts and rejects attacker hosts", () => {
  const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "https://fallback.hypertask.ai";
  test.after(() => {
    if (originalSiteUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SITE_URL;
    } else {
      process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
    }
  });

  const { getRequestBaseUrl, isAllowedAuthHost } = loadTs(
    "src/lib/auth/requestBaseUrl.ts"
  );

  assert.equal(isAllowedAuthHost("app.hypertask.ai"), true);
  assert.equal(
    isAllowedAuthHost("hypertasks-prod-feature-abc-hypertaskai.vercel.app"),
    true
  );
  assert.equal(isAllowedAuthHost("evil.example"), false);

  assert.equal(
    getRequestBaseUrl(
      new Request("https://ignored.test", {
        headers: {
          "x-forwarded-host": "app.hypertask.ai",
          "x-forwarded-proto": "https",
        },
      })
    ),
    "https://app.hypertask.ai"
  );

  assert.equal(
    getRequestBaseUrl(
      new Request("https://ignored.test", {
        headers: {
          "x-forwarded-host": "localhost:3000, proxy.local",
          "x-forwarded-proto": "http, https",
        },
      })
    ),
    "http://localhost:3000"
  );

  assert.equal(
    getRequestBaseUrl({
      headers: {
        host: "evil.example",
      },
    }),
    "https://fallback.hypertask.ai"
  );

  assert.equal(
    getRequestBaseUrl({
      headers: {
        host: ["127.0.0.1:3000", "evil.example"],
        "x-forwarded-proto": "ftp",
      },
    }),
    "https://127.0.0.1:3000"
  );
});
