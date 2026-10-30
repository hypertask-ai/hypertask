const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const load = () => import("../scripts/shared-lists/build.mjs");

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "shared-lists-"));
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

test("every built list equals its per-entry files, so two authors never edit one list", async () => {
  const { LISTS, build } = await load();
  const drift = LISTS.filter((list) => build(list) !== fs.readFileSync(path.join(root, list.target), "utf8"))
    .map((list) => `${list.target} does not match ${list.directory}/. Run node scripts/shared-lists/build.mjs --write`);
  assert.deepEqual(drift, []);
});

test("the flag copy has exactly one entry file per flag it lists", async () => {
  const { listById, entryFiles } = await load();
  const list = listById("flag-modes");
  const snapshot = JSON.parse(fs.readFileSync(path.join(root, list.target), "utf8"));
  assert.deepEqual(entryFiles(list).map((file) => file.replace(/\.json$/, "")), Object.keys(snapshot.modes));
});

test("every section file and row file is named so the builder picks it up", async () => {
  const { LISTS } = await load();
  const stray = [];
  for (const list of LISTS) {
    for (const name of fs.readdirSync(path.join(root, list.directory))) {
      if (name.startsWith("_") || list.entryPattern.test(name)) continue;
      stray.push(`${list.directory}/${name}`);
    }
  }
  assert.deepEqual(stray, [], "one file per entry, named <nn>-<slug>.md, <slug>.md or <flag-key>.json");
});

test("sections are joined in file-name order with one blank line between them", async () => {
  const { build, listById } = await load();
  const list = listById("ci-notes");
  const workspace = tempRoot();
  write(path.join(workspace, list.directory, "02-next.md"), "# Next\n\nbody\n");
  write(path.join(workspace, list.directory, "01-first.md"), "# First\n\nbody\n\n\n");
  assert.equal(build(list, workspace), "# First\n\nbody\n\n# Next\n\nbody\n");
  fs.rmSync(workspace, { recursive: true, force: true });
});

test("one new row file changes only the row block of the index", async () => {
  const { build, listById } = await load();
  const list = listById("feature-map-index");
  const workspace = tempRoot();
  const target = path.join(workspace, list.target);
  write(target, `# Index\n\n| Area | File |\n|---|---|\n${list.start}\n${list.end}\n\n## After\n`);
  write(path.join(workspace, list.directory, "b.md"), "| B | [b.md](b.md) |\n");
  write(path.join(workspace, list.directory, "a.md"), "| A | [a.md](a.md) |\n");
  const built = build(list, workspace);
  assert.match(built, /\| A \| \[a\.md\]\(a\.md\) \|\n\| B \| \[b\.md\]\(b\.md\) \|/);
  assert.ok(built.startsWith("# Index\n\n| Area | File |\n|---|---|\n"));
  assert.ok(built.endsWith("\n\n## After\n"));
  write(target, built);
  assert.equal(build(list, workspace), built, "rebuilding an unchanged index changes nothing");
  fs.rmSync(workspace, { recursive: true, force: true });
});

test("a badly named flag file or a missing mode fails loudly instead of shipping a broken list", async () => {
  const { build, listById } = await load();
  const list = listById("flag-modes");
  const workspace = tempRoot();
  write(path.join(workspace, list.directory, "_header.json"), JSON.stringify({ source: "s", view: "v", capturedAt: "2026-10-30T00:00:00.000Z" }));
  write(path.join(workspace, list.directory, "htpr-1-a.json"), JSON.stringify({ mode: "EVERYONE" }));
  assert.match(build(list, workspace), /"htpr-1-a": "EVERYONE"/);
  write(path.join(workspace, list.directory, "Not A Key.json"), JSON.stringify({ mode: "EVERYONE" }));
  assert.throws(() => build(list, workspace), /not a valid flag key/);
  fs.rmSync(path.join(workspace, list.directory, "Not A Key.json"));
  write(path.join(workspace, list.directory, "htpr-1-a.json"), JSON.stringify({ mode: "" }));
  assert.throws(() => build(list, workspace), /mode must be a non-empty string/);
  fs.rmSync(workspace, { recursive: true, force: true });
});

test("the check fails when a built list drifts from its entries", async () => {
  const { build, listById } = await load();
  const list = listById("ci-notes");
  const workspace = tempRoot();
  write(path.join(workspace, list.directory, "01-only.md"), "# Only\n");
  write(path.join(workspace, list.target), "# Only\n\nhand edit\n");
  assert.notEqual(build(list, workspace), fs.readFileSync(path.join(workspace, list.target), "utf8"));
  fs.rmSync(workspace, { recursive: true, force: true });
});
