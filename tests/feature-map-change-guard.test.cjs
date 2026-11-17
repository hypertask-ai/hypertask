const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");

const script = path.join(__dirname, "../.github/scripts/feature-map-change-guard.mjs");
const folder = ".claude/skills/verify-qa/reference/feature-map";

const load = () => import(script);

function git(repo, args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "feature-map-guard-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, ["init", "-b", "production"]);
  git(root, ["config", "user.email", "fixture@example.invalid"]);
  git(root, ["config", "user.name", "Fixture"]);
  const commit = (files, message) => {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      writeFileSync(path.join(root, name), text);
    }
    git(root, ["add", "."]);
    git(root, ["commit", "-m", message]);
    return git(root, ["rev-parse", "HEAD"]).trim();
  };
  return { root, commit };
}

test("reads the tag from a PR title", async () => {
  const { tagOf } = await load();
  assert.equal(tagOf("HTPR-1 [FEATURE] Add maps"), "FEATURE");
  assert.equal(tagOf("HTPR-1 [IMPROVE] Faster maps"), "IMPROVE");
  assert.equal(tagOf("HTPR-1 [BUGFIX] Broken map"), "BUGFIX");
  assert.equal(tagOf("Loose PR title"), null);
});

test("only app and component source counts as user-facing", async () => {
  const { isUserFacing } = await load();
  assert.equal(isUserFacing("src/app/settings/page.tsx"), true);
  assert.equal(isUserFacing("src/components/Editor.tsx"), true);
  assert.equal(isUserFacing("src/lib/flags/definitions/htpr-1-x.ts"), false);
  assert.equal(isUserFacing("src/app/settings/page.test.tsx"), false);
  assert.equal(isUserFacing("src/app/__tests__/settings.tsx"), false);
  assert.equal(isUserFacing("docs/ci.md"), false);
});

test("exempt tags and non user-facing changes pass", async () => {
  const { evaluate } = await load();
  const changedFiles = ["src/app/settings/page.tsx"];
  for (const title of ["HTPR-1 [BUGFIX] Fix settings", "HTPR-1 [INFRA] Move settings", "HTPR-1 [REFACTOR] Tidy settings", "HTPR-1 [FEATURE] Docs only"]) {
    const files = title.endsWith("Docs only") ? ["docs/ci.md"] : changedFiles;
    assert.equal(evaluate({ title, changedFiles: files, mapPages: [] }).ok, true, title);
  }
});

test("a feature with no map page fails and names the folder", async () => {
  const { evaluate, formatFailure, mapFolder } = await load();
  const result = evaluate({ title: "HTPR-1 [FEATURE] Add settings", changedFiles: ["src/app/settings/page.tsx"], mapPages: [] });
  assert.equal(result.ok, false);
  assert.deepEqual(result.areas, ["src/app/settings"]);
  const message = formatFailure(result);
  assert.match(message, new RegExp(mapFolder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(message, /src\/app\/settings/);
});

test("a map page that cites the area passes", async () => {
  const { evaluate } = await load();
  const result = evaluate({
    title: "HTPR-1 [IMPROVE] Faster settings",
    changedFiles: ["src/app/settings/page.tsx", `${folder}/settings.md`],
    mapPages: [{ status: "M", path: `${folder}/settings.md`, text: "# Settings\n\n`src/app/settings/page.tsx`\n" }],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.pages, [`${folder}/settings.md`]);
});

test("a map page for a different area still fails", async () => {
  const { evaluate } = await load();
  const result = evaluate({
    title: "HTPR-1 [FEATURE] Add settings",
    changedFiles: ["src/app/settings/page.tsx"],
    mapPages: [{ status: "M", path: `${folder}/billing.md`, text: "# Billing\n\n`src/app/billing/page.tsx`\n" }],
  });
  assert.equal(result.ok, false);
  assert.match(result.reasons.join(" "), /src\/app\/settings/);
});

test("a citation to another area's changed file does not cover this area", async () => {
  const { evaluate } = await load();
  const result = evaluate({
    title: "HTPR-1 [FEATURE] Add settings",
    changedFiles: ["src/app/settings/page.tsx", "src/components/Editor.tsx", `${folder}/settings.md`],
    mapPages: [{ status: "M", path: `${folder}/settings.md`, text: "# Settings\n\n`src/app/settings/page.tsx`\n" }],
  });
  assert.equal(result.ok, false);
  assert.match(result.reasons.join(" "), /uncovered areas: src\/components/);
});

test("editing only the map index fails", async () => {
  const { evaluate } = await load();
  const result = evaluate({
    title: "HTPR-1 [FEATURE] Add settings",
    changedFiles: ["src/app/settings/page.tsx"],
    mapPages: [{ status: "M", path: `${folder}/INDEX.md`, text: "| Settings | [settings](settings.md) | `src/app/settings/page.tsx` |\n" }],
  });
  assert.equal(result.ok, false);
});

test("real feature PR 3182 has no map entry and fails", async () => {
  const { evaluate } = await load();
  const changedFiles = [
    "src/components/PageComponents/Kanban/HeaderComponents/ShellViewControls.tsx",
    "src/components/PageComponents/Kanban/HeaderComponents/TableTagGroupPicker.tsx",
    "src/components/PageComponents/Kanban/TableView/TableView.tsx",
    "src/components/PageComponents/Kanban/TableView/useTableActions.ts",
    "src/components/PageComponents/Kanban/TableView/useTableState.ts",
    "src/hooks/Homepage/Views/useKanbanViews.ts",
    "src/lib/api/project-writes/views/gate-table-group-by.ts",
    "src/lib/flags/definitions/htpr-8974-table-group-modes.ts",
    "src/lib/table-view/tableGroupByTag.ts",
    "tests/htpr-8974-table-groups.test.ts",
  ];
  const result = evaluate({ title: "HTPR-8974 [FEATURE] Choose table groups and tags", changedFiles, mapPages: [] });
  assert.equal(result.ok, false);
  assert.deepEqual(result.areas, ["src/components/PageComponents"]);
});

test("real feature PR 3302 edits its map page and passes", async () => {
  const { evaluate } = await load();
  const changedFiles = [
    `${folder}/boards-and-views.md`,
    "src/components/PageComponents/Kanban/HeaderComponents/ShellViewControls.tsx",
    "src/components/PageComponents/Kanban/TableView/TableView.tsx",
    "src/hooks/Homepage/Views/useKanbanViews.ts",
    "tests/htpr-8974-table-groups.test.ts",
  ];
  const text = "# Boards and views\n\n`.kanban-column-title`, `src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx`\n";
  const result = evaluate({ title: "HTPR-8974 [FEATURE] Add missing table group actions", changedFiles, mapPages: [{ status: "M", path: `${folder}/boards-and-views.md`, text }] });
  assert.equal(result.ok, true);
});

test("reads the real diff and map contents from git", async t => {
  const { root, commit } = fixture(t);
  const base = commit({ "src/app/settings/page.tsx": "export default 1;\n" }, "base");
  const head = commit({
    "src/app/settings/page.tsx": "export default 2;\n",
    [`${folder}/settings.md`]: "# Settings\n\n`src/app/settings/page.tsx`\n",
  }, "change");
  const { readChange, evaluate } = await load();
  const change = readChange(base, head, root);
  assert.deepEqual(change.changedFiles.sort(), ["src/app/settings/page.tsx", `${folder}/settings.md`].sort());
  assert.equal(evaluate({ title: "HTPR-1 [IMPROVE] Settings", ...change }).ok, true);
  assert.equal(evaluate({ title: "HTPR-1 [FEATURE] Settings", changedFiles: change.changedFiles, mapPages: [] }).ok, false);
});

test("the command exits non-zero and prints the fix", async t => {
  const { root, commit } = fixture(t);
  const base = commit({ "src/app/settings/page.tsx": "export default 1;\n" }, "base");
  const head = commit({ "src/app/settings/page.tsx": "export default 2;\n" }, "change");
  const run = spawnSync(process.execPath, [script, base, head, "HTPR-1 [FEATURE] Add settings"], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /Map folder: \.claude\/skills\/verify-qa\/reference\/feature-map\//);
  assert.match(run.stdout, /src\/app\/settings/);
});
