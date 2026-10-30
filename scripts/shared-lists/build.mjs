// Regenerates the repository's shared lists from one small file per entry, so two authors adding
// or retiring different entries never touch the same file (HTPR-8194).
//
//   node scripts/shared-lists/build.mjs --write   rewrite every built file from its entries
//   node scripts/shared-lists/build.mjs --check   fail when a built file differs from its entries
//
// Each built file keeps its path, so every existing reader keeps working. Entries are ordered by
// file name, never by insertion into the built file.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FLAG_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SECTION_FILE = /^\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const ROW_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const ROW_START = "<!-- shared-list rows: one file per row in rows/, rebuilt by node scripts/shared-lists/build.mjs --write -->";
const ROW_END = "<!-- shared-list rows end -->";

export const LISTS = [
  {
    id: "flag-modes",
    kind: "json-map",
    directory: "e2e/smoke/flag-modes",
    headerFile: "_header.json",
    target: "e2e/smoke/production-flag-modes.json",
    entryPattern: /^[a-z0-9]+(?:-[a-z0-9]+)*\.json$/,
    name: (file) => file.replace(/\.json$/, ""),
    validate: (key) => FLAG_KEY.test(key),
    fields: ["mode"],
  },
  {
    id: "ci-notes",
    kind: "concat",
    directory: "docs/ci",
    target: "docs/ci.md",
    entryPattern: SECTION_FILE,
  },
  {
    id: "feature-map-index",
    kind: "region",
    directory: ".claude/skills/verify-qa/reference/feature-map/rows",
    target: ".claude/skills/verify-qa/reference/feature-map/INDEX.md",
    entryPattern: ROW_FILE,
    start: ROW_START,
    end: ROW_END,
  },
];

export const listById = (id) => LISTS.find((list) => list.id === id);

const read = (relative, root = ROOT) => readFileSync(path.join(root, relative), "utf8");

export function entryFiles(list, root = ROOT) {
  const directory = path.join(root, list.directory);
  if (!existsSync(directory)) throw new Error(`${list.directory} is missing`);
  const names = readdirSync(directory);
  const strays = names.filter((name) => !name.startsWith("_") && !list.entryPattern.test(name));
  if (strays.length) throw new Error(`${list.directory}: ${strays.join(", ")} is not an entry file name (one file per entry)`);
  return names.filter((name) => list.entryPattern.test(name)).sort();
}

function buildJsonMap(list, root) {
  const header = JSON.parse(read(path.join(list.directory, list.headerFile), root));
  const modes = {};
  for (const file of entryFiles(list, root)) {
    const key = list.name(file);
    if (!list.validate(key)) throw new Error(`${list.directory}/${file}: file name is not a valid flag key`);
    const entry = JSON.parse(read(path.join(list.directory, file), root));
    for (const field of list.fields) {
      if (typeof entry[field] !== "string" || !entry[field]) throw new Error(`${list.directory}/${file}: ${field} must be a non-empty string`);
    }
    modes[key] = entry.mode;
  }
  const snapshot = {};
  for (const [field, value] of Object.entries(header)) if (field !== "modes") snapshot[field] = value;
  snapshot.modes = modes;
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

function buildConcat(list, root) {
  const files = entryFiles(list, root);
  if (!files.length) throw new Error(`${list.directory} has no section files`);
  return files.map((file) => `${read(path.join(list.directory, file), root).trimEnd()}\n`).join("\n");
}

function buildRegion(list, root) {
  const target = read(list.target, root);
  const start = target.indexOf(list.start);
  const end = target.indexOf(list.end);
  if (start < 0 || end < start) throw new Error(`${list.target} is missing the shared-list markers`);
  const rows = entryFiles(list, root).map((file) => read(path.join(list.directory, file), root).trim()).filter(Boolean);
  return `${target.slice(0, start + list.start.length)}\n${rows.join("\n")}\n${target.slice(end)}`;
}

const builders = { "json-map": buildJsonMap, concat: buildConcat, region: buildRegion };

export function build(list, root = ROOT) {
  const builder = builders[list.kind];
  if (!builder) throw new Error(`${list.id}: unknown kind ${list.kind}`);
  return builder(list, root);
}

function main(argv) {
  const write = argv.includes("--write");
  if (!write && !argv.includes("--check")) {
    console.error("usage: shared-lists/build.mjs --write | --check");
    process.exit(2);
  }
  const problems = [];
  for (const list of LISTS) {
    const target = path.join(ROOT, list.target);
    let built;
    try {
      built = build(list);
    } catch (error) {
      problems.push(`${list.id}: ${error.message}`);
      continue;
    }
    if (write) {
      writeFileSync(target, built);
      console.log(`${list.id}: wrote ${list.target} from ${entryFiles(list).length} entry files`);
    } else if (!existsSync(target) || read(list.target) !== built) {
      problems.push(`${list.id}: ${list.target} does not match ${list.directory}/. Run node scripts/shared-lists/build.mjs --write`);
    }
  }
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  if (!write) console.log(`${LISTS.length} shared lists match their per-entry files`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
