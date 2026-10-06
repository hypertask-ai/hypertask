const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { renderToStaticMarkup } = require("react-dom/server");
const { root, loadTs } = require("./slack-app-fixtures.cjs");

const keys = loadTs("src/lib/flags/keys.ts");
const marketplaceKey = keys.HTPR_6921_SLACK_MARKETPLACE_FLAG;
const flags = loadTs("src/lib/flags.ts", {
  "@/lib/prisma": { __esModule: true, default: { featureFlag: { findMany: async () => [] } } },
  "@/lib/auth/getSessionUser": {},
});

function loadPage(relativePath, user, isFeatureEnabled) {
  const javascript = ts.transpileModule(fs.readFileSync(path.join(root, relativePath), "utf8"), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: relativePath,
  }).outputText;
  const mocks = {
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
  };
  const mod = { exports: {} };
  new Function("module", "exports", "require", javascript)(mod, mod.exports, (request) => {
    if (Object.hasOwn(mocks, request)) return mocks[request];
    assert.ok(["react/jsx-runtime", "next/link"].includes(request), `Unexpected dependency: ${request}`);
    return require(request);
  });
  return mod.exports.default;
}

const supportPath = "src/app/slack/support/page.tsx";
const installPath = "src/app/add-to-slack/page.tsx";

test("Marketplace flag exists and defaults to Owner + QA, not anonymous or other members", async () => {
  assert.equal(marketplaceKey, "htpr-6921-slack-marketplace");
  assert.ok(flags.FEATURE_FLAG_KEYS.includes(marketplaceKey));
  const db = {
    featureFlag: { findUnique: async () => null, findMany: async () => [] },
    user: { findUnique: async ({ where }) => ({ email: where.id === 6 ? "valentin.yeo@gmail.com" : "valentin@hypertask.ai" }) },
  };
  const entry = (await flags.listFeatureFlagModes()).find(({ key }) => key === marketplaceKey);
  assert.equal(entry.mode, "OWNER_AND_QA");
  assert.deepEqual(await Promise.all([6, 985, 7, -1].map(id => flags.isFeatureEnabled(marketplaceKey, id, db))), [true, true, false, false]);
  db.featureFlag.findUnique = async () => ({ mode: "OFF" });
  assert.equal(await flags.isFeatureEnabled(marketplaceKey, 6, db), false);
});

test("support calls notFound on the server when its flag is off for signed-in or anonymous visitors", async () => {
  for (const user of [null, { id: 6 }, { id: 985 }]) {
    const calls = [];
    const page = loadPage(supportPath, user, async (...args) => { calls.push(args); return false; });
    await assert.rejects(page(), /NOT_FOUND/);
    assert.deepEqual(calls, [[marketplaceKey, user?.id ?? -1]]);
  }
});

test("support renders anonymously when enabled and includes setup, retention, uninstall, and existing support email", async () => {
  const calls = [];
  const page = loadPage(supportPath, null, async (...args) => { calls.push(args); return true; });
  const html = renderToStaticMarkup(await page());
  assert.deepEqual(calls, [[marketplaceKey, -1]]);
  for (const copy of ["/ht connect", "/ht disconnect", "automatically", "8,000 bytes", "24 hours", "no expiry", "not immediately purged", "organization-wide installs are not supported", "mailto:help@hypertask.ai"]) {
    assert.ok(html.includes(copy), copy);
  }
  const existingSupport = fs.readFileSync(path.join(root, "src/components/Modals/Settings/SettingsShell.tsx"), "utf8");
  assert.ok(existingSupport.includes("mailto:help@hypertask.ai"));
});

test("Add to Slack fixes /ht copy even with Marketplace off and gates only new links", async () => {
  for (const enabled of [false, true]) {
    const calls = [];
    const page = loadPage(installPath, { id: 985 }, async (key, userId) => {
      calls.push([key, userId]);
      return key === keys.HTPR_4857_ADD_TO_SLACK_FLAG || (key === marketplaceKey && enabled);
    });
    const html = renderToStaticMarkup(await page());
    assert.match(html, /Support the \/ht slash command/);
    assert.ok(html.includes("Add to Slack"));
    assert.deepEqual(calls, [[keys.HTPR_4857_ADD_TO_SLACK_FLAG, 985], [marketplaceKey, 985]]);
    for (const href of ["https://hypertask.ai/privacy/", "https://hypertask.ai/terms/", "/slack/support"]) {
      assert.equal(html.includes(`href="${href}"`), enabled, href);
    }
    assert.doesNotMatch(html, /\/hypertask\b(?!\.)/);
  }
  const page = loadPage(installPath, null, async () => false);
  await assert.rejects(page(), /NOT_FOUND/);
});

test("support is exempt from signed-out and incomplete-onboarding redirects, without exposing sibling routes", () => {
  const proxy = fs.readFileSync(path.join(root, "src/proxy.ts"), "utf8");
  const publicRoutes = proxy.slice(proxy.indexOf("// Allow public routes"), proxy.indexOf("// HTPR-4845"));
  const onboarding = proxy.slice(proxy.indexOf("!checkIfOnboarded(user)"), proxy.indexOf("// Voluntary /trial"));
  assert.match(publicRoutes, /currentPath === '\/slack\/support'/);
  assert.match(onboarding, /currentPath !== '\/slack\/support'/);
  assert.equal(publicRoutes.includes("currentPath.startsWith('/slack')"), false);
});

test("submission keeps organization deployment off and documents the support URL and real storage", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "docs/slack-app-manifest.json"), "utf8"));
  assert.equal(manifest.settings.org_deploy_enabled, false);
  const doc = fs.readFileSync(path.join(root, "docs/slack-marketplace-submission.md"), "utf8");
  for (const copy of ["https://app.hypertask.ai/slack/support", "team.id", "8,000 bytes", "24-hour TTL", "automatically link", "not purged immediately", "htpr-6921-slack-marketplace"]) {
    assert.ok(doc.includes(copy), copy);
  }
  for (const relativePath of [supportPath, installPath, "docs/slack-marketplace-submission.md"]) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    assert.equal(source.includes("\u2014"), false, relativePath);
    assert.doesNotMatch(source, /\/hypertask\b(?!\.)/, relativePath);
  }
});
