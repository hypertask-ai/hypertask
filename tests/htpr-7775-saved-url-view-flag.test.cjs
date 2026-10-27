process.env.FEATURE_FLAG_TYPESCRIPT_PATH = require.resolve("typescript");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const filename = "src/lib/flags/definitions/htpr-7775-saved-url-view.ts";

test("saved URL view bugfix flag defaults to Everyone with small release risk", async () => {
  const { parseFlagFile } = await import("../.github/scripts/feature-flag-registry.mjs");
  const { definition } = parseFlagFile(fs.readFileSync(path.join(root, filename), "utf8"), filename);
  assert.equal(definition.key, "htpr-7775-saved-url-view");
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason.length > 0);
});

test("cached and network board URL selection both pass the reactive flag to section restoration", () => {
  const source = fs.readFileSync(path.join(root, "src/app/[...boardURL]/LandingPage.tsx"), "utf8");
  assert.match(source, /import \{ HTPR_7775_SAVED_URL_VIEW_FLAG \} from "@\/lib\/flags\/keys"/);
  assert.equal((source.match(/const restoreUrlViewSections = useFlag\(HTPR_7775_SAVED_URL_VIEW_FLAG\)/g) ?? []).length, 2);
  assert.match(source, /pinProjectToUrlView\(localProject, currentView, \{ [^}]*legacyAgentAssigneeMatch: !assigneeFixEnabled[^}]*\}, restoreUrlViewSections\)/);
  assert.match(source, /pinProjectToUrlView\(projects\[projectIndex\], currentView, \{ [^}]*legacyAgentAssigneeMatch: !assigneeFixEnabled[^}]*\}, restoreUrlViewSections\)/);
  assert.match(source, /\[\s*assigneeFixEnabled,[\s\S]*?restoreUrlViewSections,[\s\S]*?boardAccessKey/);
  assert.match(source, /\[assigneeFixEnabled,[\s\S]*?restoreUrlViewSections,[\s\S]*?data\?\.updatedProjects, projectIndex, currentView\]/);
});
