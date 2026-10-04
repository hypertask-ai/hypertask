const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { root, loadTs } = require("./slack-app-fixtures.cjs");

const doc = fs.readFileSync(path.join(root, "docs/slack-app.md"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "docs/slack-app-manifest.json"), "utf8"));

test("documented bot scopes match the manifest and production OAuth scope list", () => {
  const { SLACK_BOT_SCOPES } = loadTs("src/lib/slack/authorize.ts");
  assert.deepEqual([...manifest.oauth_config.scopes.bot].sort(), [...SLACK_BOT_SCOPES].sort());
  for (const scope of SLACK_BOT_SCOPES) assert.ok(doc.includes(`\`${scope}\``), scope);
});

test("all configured endpoints and assistant/chat events are documented", () => {
  for (const url of [manifest.features.slash_commands[0].url, manifest.settings.event_subscriptions.request_url, ...manifest.oauth_config.redirect_urls]) {
    assert.ok(doc.includes(url), url);
    const apiPath = new URL(url).pathname;
    assert.ok(fs.existsSync(path.join(root, "src/app", apiPath, "route.ts")));
  }
  for (const event of manifest.settings.event_subscriptions.bot_events) assert.ok(doc.includes(`\`${event}\``), event);
  assert.ok(manifest.settings.event_subscriptions.bot_events.includes("assistant_thread_context_changed"));
  assert.equal(manifest.features.app_home.messages_tab_enabled, true);
  assert.equal(manifest.features.app_home.messages_tab_read_only, false);
  assert.equal(manifest.settings.interactivity.is_enabled, false);
});

test("rollout, identity, storage, signed webhook and deferred-operation risks are explicit", () => {
  for (const text of ["htpr-6817-slack-app", "Owner + QA", "When off", "thirteen", "fourteen", "HyperAI integration identity", "five-minute", "single-use", "persistent Redis", "Marketplace", "Do not uninstall", "Live Slack verification"]) {
    assert.ok(doc.includes(text), text);
  }
  assert.equal(doc.includes("\u2014"), false);
});
