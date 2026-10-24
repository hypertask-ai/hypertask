import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FLAG_REMOVAL_TICKETS_PER_RUN, removalWindowDays, selectDueFlags } from "../../src/lib/flags/removalWindow.mjs";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function registry() {
  process.env.FEATURE_FLAG_TYPESCRIPT_PATH ??= createRequire(import.meta.url).resolve("typescript");
  return import("../../.github/scripts/feature-flag-registry.mjs");
}

export async function loadDefinitions(root) {
  const { FLAG_DEFINITIONS_DIRECTORY, parseFlagFiles } = await registry();
  const directory = path.join(root, FLAG_DEFINITIONS_DIRECTORY);
  const names = readdirSync(directory).filter((name) => name.endsWith(".ts") && name !== "index.generated.ts").sort();
  return parseFlagFiles(
    names.map((name) => FLAG_DEFINITIONS_DIRECTORY + name),
    (name) => readFileSync(path.join(root, name), "utf8"),
  ).map(({ definition }) => definition);
}

export function streakStarts(history) {
  const active = new Map();
  for (const commit of history) {
    const modes = commit.modes ?? {};
    for (const [key, mode] of Object.entries(modes)) {
      if (mode === "EVERYONE") {
        if (!active.has(key)) active.set(key, commit.date);
      } else {
        active.delete(key);
      }
    }
  }
  return Object.fromEntries(active);
}

export function removalCandidates({ definitions, modes, since, now, already = [] }) {
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
  const alreadyKeys = new Set(already);
  const rows = [];
  const missingSince = [];
  for (const [key, mode] of Object.entries(modes)) {
    const definition = byKey.get(key);
    if (!definition || mode !== "EVERYONE") continue;
    const releasedAt = since[key];
    if (!releasedAt) {
      missingSince.push(key);
      continue;
    }
    rows.push({
      key,
      mode,
      releasedAt,
      keep: false,
      removalTaskId: null,
      kind: definition.kind ?? "feature",
      highRisk: definition.releaseRisk?.highRisk ?? null,
    });
  }
  const due = selectDueFlags(rows, now);
  const fresh = [];
  const alreadyRecorded = [];
  for (const row of due) {
    const item = {
      key: row.key,
      kind: row.kind ?? "feature",
      highRisk: row.highRisk,
      windowDays: removalWindowDays(row),
      everyoneSince: new Date(row.releasedAt).toISOString(),
      title: `Remove feature flag ${row.key}`,
    };
    if (alreadyKeys.has(row.key)) alreadyRecorded.push(item);
    else fresh.push(item);
  }
  const wouldFile = fresh.slice(0, FLAG_REMOVAL_TICKETS_PER_RUN);
  return {
    dryRun: true,
    filesTickets: false,
    switchesMode: false,
    now: now.toISOString(),
    ticketsPerRun: FLAG_REMOVAL_TICKETS_PER_RUN,
    wouldFile,
    deferred: fresh.length - wouldFile.length,
    alreadyRecorded,
    newTickets: wouldFile.length,
    filed: 0,
    missingSince,
  };
}

function historySince(root, relativePath) {
  const log = execFileSync("git", ["log", "--reverse", "--format=%H%x09%cI", "--", relativePath], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (!log) throw new Error(`No git history for ${relativePath}`);
  const history = log.split("\n").map((line) => {
    const [sha, date] = line.split("\t");
    try {
      const text = execFileSync("git", ["show", `${sha}:${relativePath}`], { cwd: root, encoding: "utf8" });
      return { date, modes: JSON.parse(text).modes ?? {} };
    } catch {
      return { date, modes: {} };
    }
  });
  return streakStarts(history);
}

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

function alreadyKeys(file) {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  const listed = [
    ...(parsed.keys ?? []),
    ...(parsed.wouldFile ?? []),
    ...(parsed.alreadyRecorded ?? []),
  ];
  return listed.map((item) => typeof item === "string" ? item : item.key);
}

async function main(argv, root) {
  if (argv.includes("--file") || argv.includes("--apply")) {
    throw new Error("This command never files tickets or switches a flag. /api/cron/feature-flag-removals files the ticket.");
  }
  const snapshotPath = path.resolve(root, option(argv, "--snapshot") ?? "e2e/smoke/production-flag-modes.json");
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const since = option(argv, "--since")
    ? JSON.parse(readFileSync(path.resolve(root, option(argv, "--since")), "utf8"))
    : historySince(root, path.relative(root, snapshotPath));
  const now = option(argv, "--now") ? new Date(option(argv, "--now")) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error("--now must be a date");
  const already = option(argv, "--already") ? alreadyKeys(path.resolve(root, option(argv, "--already"))) : [];
  const report = removalCandidates({
    definitions: await loadDefinitions(root),
    modes: snapshot.modes ?? {},
    since,
    now,
    already,
  });
  console.log(JSON.stringify({ ...report, snapshotCapturedAt: snapshot.capturedAt ?? null }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2), defaultRoot);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
