const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { renderToStaticMarkup } = require("react-dom/server");
const { root, loadModule } = require("./helpers/loadModule.cjs");
const keys = require("./helpers/flag-files.cjs").load("src/lib/flags/keys.ts");

function loadPage(relativePath, user, isFeatureEnabled) {
  return loadModule(relativePath, {
    "next/navigation": { notFound: () => { throw new Error("NOT_FOUND"); } },
    "next/headers": { headers: async () => new Headers() },
    "@/lib/auth/serverUser": { getServerCookieUser: async () => user },
    "@/lib/auth/requestBaseUrl": { getRequestBaseUrl: () => "https://app.hypertask.ai" },
    "@/lib/flags": { isFeatureEnabled },
    "@/lib/flags/keys": keys,
    "@/lib/slack/authorize": {
      SLACK_BOT_SCOPES: ["commands"],
      buildSlackAuthorizeUrl: () => new URL("https://slack.com/oauth/v2/authorize"),
    },
  }).default;
}

const supportPath = "src/app/slack/support/page.tsx";
const installPath = "src/app/add-to-slack/page.tsx";

test("support renders for signed-in and anonymous visitors without reading flags", async () => {
  for (const user of [null, { id: 6 }, { id: 985 }]) {
    const page = loadPage(supportPath, user, () => assert.fail("support must not read flags"));
    const html = renderToStaticMarkup(await page());
    for (const copy of ["/ht connect", "/ht disconnect", "automatically", "8,000 bytes", "24 hours", "no expiry", "not immediately purged", "organization-wide installs are not supported", "mailto:help@hypertask.ai"]) {
      assert.ok(html.includes(copy), copy);
    }
  }
});

test("Add to Slack always shows legal and support links while retaining its install flag", async () => {
  for (const user of [null, { id: 985 }]) {
    const calls = [];
    const page = loadPage(installPath, user, async (key, userId) => {
      calls.push([key, userId]);
      return key === keys.HTPR_4857_ADD_TO_SLACK_FLAG;
    });
    const html = renderToStaticMarkup(await page());
    assert.match(html, /Support the \/ht slash command/);
    assert.ok(html.includes("Add to Slack"));
    assert.deepEqual(calls, [[keys.HTPR_4857_ADD_TO_SLACK_FLAG, user?.id ?? -1]]);
    for (const href of ["https://hypertask.ai/privacy/", "https://hypertask.ai/terms/", "/slack/support"]) {
      assert.ok(html.includes(`href="${href}"`), href);
    }
    assert.doesNotMatch(html, /\/hypertask\b(?!\.)/);
  }
  const page = loadPage(installPath, null, async () => false);
  await assert.rejects(page(), /NOT_FOUND/);
});

test("support is exempt from signed-out and incomplete-onboarding redirects, without exposing sibling routes", async () => {
  const { harness } = require("./helpers/agent-cookie-bridge.cjs");
  const h = harness();
  for (const kind of ["none", "human"]) {
    const cookies = { nookies_user: JSON.stringify({ id: 7, UserSetting: { onboardingTourStatus: false } }) };
    const options = { kind, ...(kind === "human" ? { cookies } : {}) };
    const support = await h.proxy(h.request("/slack/support", options));
    assert.equal(support.headers.get("x-middleware-next"), "1");
    const sibling = await h.proxy(h.request("/slack/private", options));
    assert.equal(sibling.status, 307);
    assert.equal(new URL(sibling.headers.get("location")).pathname, kind === "none" ? "/login" : "/onboarding");
  }
});

test("submission keeps organization deployment off and documents the support URL and real storage", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "docs/slack-app-manifest.json"), "utf8"));
  assert.equal(manifest.settings.org_deploy_enabled, false);
  const doc = fs.readFileSync(path.join(root, "docs/slack-marketplace-submission.md"), "utf8");
  for (const copy of ["https://app.hypertask.ai/slack/support", "team.id", "8,000 bytes", "24-hour TTL", "automatically link", "not purged immediately"]) {
    assert.ok(doc.includes(copy), copy);
  }
});
