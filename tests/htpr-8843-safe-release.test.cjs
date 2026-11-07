const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "src/prisma/migrations/20261107143000_htpr_8843_release_reversible_flags/migration.sql"),
  "utf8",
);

const RELEASED = [
  "htpr-3533-google-calendar",
  "htpr-5908-local-writing-assistance",
  "htpr-6906-autocap-undo",
  "htpr-6921-slack-marketplace",
  "htpr-7363-chat-task-writer",
  "htpr-7509-agent-role-screen",
  "htpr-7509-write-agents-create-boards",
  "htpr-7529-mcp-act-as-agent",
  "htpr-7574-owned-unattached-agents",
  "htpr-7577-add-existing-agent",
  "htpr-7582-agent-access-request",
  "htpr-7622-ai-settings",
  "htpr-7663-scoped-agent-skills",
  "htpr-7686-free-plan-copy",
  "htpr-7799-project-entry",
  "htpr-7854-ai-thinking-opt-in",
  "htpr-7919-allowance-percent",
  "htpr-7977-short-task-writer",
  "htpr-8084-cross-team-agents",
  "htpr-8100-no-paid-fallback",
  "htpr-8143-quiet-agent-updates",
  "htpr-8215-agent-archive-delete",
  "htpr-8231-agent-archive-done",
  "htpr-8716-quick-entry-focus",
  "htpr-8804-visible-links-first",
  "htpr-8826-blocked-by-me-list",
  "htpr-8846-agent-lane-on-readable-board",
  "htpr-8881-board-view-filters",
  "yper4-651-self-follow-quiet",
];

const HELD = {
  "htpr-7037-shared-email-layout": "customer-email",
  "htpr-7575-phone-chat-delete": "data-deletion",
  "htpr-7730-deepseek-flash-fast": "money",
  "htpr-8216-agent-task-share": "access",
  "htpr-7328-rounded-theme": undefined,
  "htpr-7549-first-task-pointer": undefined,
  "htpr-7146-agent-scope-enforce": "access",
};

function modeOf(definition) {
  return definition.defaultMode ?? (definition.kind === "bugfix" ? "EVERYONE" : "OWNER_AND_QA");
}

test("reversible flags ship to everyone and the release migration names each one", async () => {
  process.env.FEATURE_FLAG_TYPESCRIPT_PATH = require.resolve("typescript");
  const { parseFlagFiles } = await import("../.github/scripts/feature-flag-registry.mjs");
  const paths = fs.readdirSync(path.join(root, "src/lib/flags/definitions"))
    .filter((name) => name.endsWith(".ts") && name !== "index.generated.ts")
    .map((name) => `src/lib/flags/definitions/${name}`);
  const definitions = parseFlagFiles(paths, (file) => fs.readFileSync(path.join(root, file), "utf8"))
    .map((row) => row.definition);
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));

  for (const key of RELEASED) {
    const definition = byKey.get(key);
    assert.ok(definition, key);
    assert.equal(modeOf(definition), "EVERYONE", key);
    assert.equal(definition.releaseRisk?.highRisk, undefined, key);
    assert.equal(migration.includes(`'${key}'`), true, key);
    assert.equal(definition.releaseRisk?.reason?.trim().length > 0, true, key);
  }
  assert.equal(migration.includes("flag.mode = 'OWNER_AND_QA'"), true);
  assert.equal(migration.includes("live-qa-failed:%"), true);
  assert.equal(migration.includes("'htpr-7037-shared-email-layout'"), false);
  assert.equal(migration.includes("'htpr-7730-deepseek-flash-fast'"), false);
  assert.equal(migration.includes("'htpr-8216-agent-task-share'"), false);
  assert.equal(migration.includes("'htpr-7146-agent-scope-enforce'"), false);

  for (const [key, risk] of Object.entries(HELD)) {
    const definition = byKey.get(key);
    assert.notEqual(modeOf(definition), "EVERYONE", key);
    assert.equal(definition.releaseRisk?.highRisk, risk, key);
    assert.equal(definition.releaseRisk.reason.trim().length > 0, true, key);
  }

  const theme = byKey.get("htpr-7328-rounded-theme");
  assert.equal(theme.releaseRisk.reason.toLowerCase().includes("theme"), true);
  const share = byKey.get("htpr-8216-agent-task-share");
  assert.equal(share.releaseRisk.reason.includes("public"), true);
  const price = byKey.get("htpr-7730-deepseek-flash-fast");
  assert.equal(price.releaseRisk.reason.includes("8 times"), true);
  const enforce = byKey.get("htpr-7146-agent-scope-enforce");
  assert.equal(enforce.defaultMode, "OFF");
  const pointer = byKey.get("htpr-7549-first-task-pointer");
  assert.equal(pointer.defaultMode, "OWNER_ONLY");

  for (const definition of definitions) {
    if (modeOf(definition) === "EVERYONE") continue;
    assert.equal(definition.releaseRisk?.reason?.trim().length > 0, true, definition.key);
  }
});
