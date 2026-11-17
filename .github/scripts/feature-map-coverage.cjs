const fs = require("node:fs");
const path = require("node:path");

const MAP_DIR = ".claude/skills/verify-qa/reference/feature-map";
const APP_DIR = "src/app";
const FLAG_DIR = "src/lib/flags/definitions";
const USER_KINDS = new Set(["feature", "improvement"]);

function walkPages(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkPages(full, out);
    else if (/^page\.(?:tsx|ts|jsx|js)$/.test(entry.name)) out.push(full);
  }
}

function routeOf(pageFile, appRoot) {
  const rel = path.relative(appRoot, path.dirname(pageFile));
  const parts = rel && rel !== "." ? rel.split(path.sep) : [];
  const url = [];
  for (const part of parts) {
    if (part.startsWith("(") && part.endsWith(")")) continue;
    if (part.startsWith("[[...") && part.endsWith("]]")) continue;
    if (part.startsWith("[...") && part.endsWith("]")) url.push(`:${part.slice(4, -1)}`);
    else if (part.startsWith("[") && part.endsWith("]")) url.push(`:${part.slice(1, -1)}`);
    else url.push(part);
  }
  return url.length === 0 ? "/" : `/${url.join("/")}`;
}

function routeFeatures(root) {
  const appRoot = path.join(root, APP_DIR);
  const pages = [];
  walkPages(appRoot, pages);
  const seen = new Map();
  const features = [];
  for (const page of pages.sort()) {
    const id = routeOf(page, appRoot);
    const source = path.posix.join(APP_DIR, path.relative(appRoot, page).split(path.sep).join("/"));
    if (seen.has(id)) throw new Error(`two pages share ${id}: ${seen.get(id)} and ${source}`);
    seen.set(id, source);
    features.push({ id, source, kind: "route" });
  }
  return features;
}

function flagFeatures(root) {
  const dir = path.join(root, FLAG_DIR);
  if (!fs.existsSync(dir)) return [];
  const features = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".ts") || name === "index.generated.ts") continue;
    const text = fs.readFileSync(path.join(dir, name), "utf8");
    const kind = /kind:\s*"([^"]+)"/.exec(text)?.[1];
    if (!USER_KINDS.has(kind)) continue;
    const consts = new Map();
    for (const match of text.matchAll(/export const ([A-Z0-9_]+)\s*=\s*"([^"]+)"/g)) consts.set(match[1], match[2]);
    const literal = /key:\s*"([^"]+)"/.exec(text)?.[1];
    const named = /key:\s*([A-Z0-9_]+)/.exec(text)?.[1];
    const key = literal || (named && consts.get(named));
    if (!key) throw new Error(`feature flag key missing in ${path.posix.join(FLAG_DIR, name)}`);
    features.push({ id: key, source: path.posix.join(FLAG_DIR, name), kind: "flag" });
  }
  return features;
}

function mapCorpus(root) {
  const dir = path.join(root, MAP_DIR);
  if (!fs.existsSync(dir)) return { text: "", areas: [], rows: [] };
  const areas = fs.readdirSync(dir).filter((name) => name.endsWith(".md") && name !== "INDEX.md").sort();
  const rowDir = path.join(dir, "rows");
  const rows = fs.existsSync(rowDir)
    ? fs.readdirSync(rowDir).filter((name) => name.endsWith(".md")).sort()
    : [];
  const text = areas.map((name) => fs.readFileSync(path.join(dir, name), "utf8")).join("\n");
  return { text, areas, rows };
}

function escapeReg(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dynamicSegment() {
  return "(?:<[^>\\s/]+>|:[A-Za-z_][A-Za-z0-9_]*|\\[[^\\]\\s/]+\\]|\\{[^}\\s/]+\\})";
}

function mentioned(feature, corpus) {
  if (feature.kind === "flag") {
    return new RegExp(`(?<![A-Za-z0-9-])${escapeReg(feature.id)}(?![A-Za-z0-9-])`).test(corpus);
  }
  if (corpus.includes(feature.source)) return true;
  if (feature.id === "/") return /(?:^|[\s`(])\/(?:[\s`)]|$)/m.test(corpus);
  if (feature.id.includes("/:")) {
    const segments = feature.id.split("/").filter(Boolean);
    if (segments[0].startsWith(":")) return false;
    const body = segments.map((segment) => (segment.startsWith(":") ? dynamicSegment() : escapeReg(segment))).join("/");
    return new RegExp(`(?<![A-Za-z0-9._~-])/${body}(?![A-Za-z0-9._~/-])`).test(corpus);
  }
  return new RegExp(`${escapeReg(feature.id)}(?![A-Za-z0-9._~/-])`).test(corpus);
}

function coverageReport(root, options = {}) {
  const features = [...routeFeatures(root), ...flagFeatures(root)].sort((a, b) => a.id.localeCompare(b.id) || a.kind.localeCompare(b.kind));
  const selected = options.only ? features.filter((feature) => feature.id === options.only) : features;
  if (options.only && selected.length === 0) throw new Error(`unknown feature ${options.only}`);
  const corpus = mapCorpus(root);
  const unmapped = selected.filter((feature) => !mentioned(feature, corpus.text));
  const rowGaps = [
    ...corpus.areas.filter((name) => !corpus.rows.includes(name)).map((name) => `missing row ${name}`),
    ...corpus.rows.filter((name) => !corpus.areas.includes(name)).map((name) => `missing area ${name}`),
  ];
  return {
    mapped: selected.length - unmapped.length,
    total: selected.length,
    line: `${selected.length - unmapped.length} of ${selected.length}`,
    unmapped,
    rowGaps,
  };
}

function formatReport(report) {
  const lines = [report.line, "Unmapped features:"];
  lines.push(...(report.unmapped.length === 0 ? ["- none"] : report.unmapped.map((feature) => `- ${feature.id}`)));
  if (report.rowGaps.length > 0) {
    lines.push("Map rows out of sync:");
    lines.push(...report.rowGaps.map((gap) => `- ${gap}`));
  }
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const options = { root: process.cwd(), strict: false, only: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--strict") options.strict = true;
    else if (arg === "--root" || arg === "--only") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`missing ${arg}`);
      options[arg.slice(2)] = value;
      index += 1;
    } else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv);
  const report = coverageReport(path.resolve(options.root), options);
  const text = formatReport(report);
  process.stdout.write(text);
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, text);
  return options.strict && report.unmapped.length > 0 ? 1 : 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { coverageReport, formatReport, main, routeOf, mentioned };
