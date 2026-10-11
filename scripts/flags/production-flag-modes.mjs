// Generates and checks e2e/smoke/production-flag-modes.json, the credential-free copy of the live
// feature flag modes that the browser-smoke job and the layout lock use. Never hand-edit that file.
//
//   node scripts/flags/production-flag-modes.mjs --write        read live modes, rewrite the file
//   node scripts/flags/production-flag-modes.mjs --add-defaults add flags that are new in code, with their registry default
//   node scripts/flags/production-flag-modes.mjs --check        offline: complete, valid and not too old (runs in CI)
//   node scripts/flags/production-flag-modes.mjs --check-live   file equals the live modes right now (runs where --write can run)
//
// Live modes come from /api/admin/flags when an agent session token is in the environment (exact
// modes), otherwise from the plain QA session's /api/flags view (released or not). CI never calls
// either: it only runs --check, which reads the repo alone.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FLAG_DEFINITIONS_DIRECTORY, parseFlagFiles } from "../../.github/scripts/feature-flag-registry.mjs";
import { localFlagModes, readPlainQaFlags } from "../premerge-local-flags.mjs";

export const SNAPSHOT_PATH = "e2e/smoke/production-flag-modes.json";
export const SNAPSHOT_SOURCE = "https://app.hypertask.ai/api/admin/flags";
export const MAX_AGE_DAYS = 14;
export const MODES = ["OFF", "OWNER_ONLY", "OWNER_AND_QA", "EVERYONE"];
const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Same rule as defaultFeatureFlagMode in src/lib/flags.ts.
export function definitionDefaults(root) {
  const directory = path.join(root, FLAG_DEFINITIONS_DIRECTORY);
  const paths = readdirSync(directory).filter((name) => name !== "index.generated.ts").sort()
    .map((name) => FLAG_DEFINITIONS_DIRECTORY + name);
  const rows = parseFlagFiles(paths, (name) => readFileSync(path.join(root, name), "utf8"));
  return Object.fromEntries(rows.map(({ definition }) => [
    definition.key,
    definition.defaultMode ?? (definition.kind === "bugfix" ? "EVERYONE" : "OWNER_AND_QA"),
  ]));
}

const sorted = (modes) => Object.fromEntries(Object.entries(modes).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

// live is either the admin list [{ key, mode }] (exact) or the plain QA map { key: boolean }.
export function buildSnapshot(defaults, live, now = new Date()) {
  let modes;
  let view;
  if (Array.isArray(live)) {
    const stored = new Map(live.map(({ key, mode }) => [key, mode]));
    modes = Object.fromEntries(Object.keys(defaults).map((key) => [key, stored.get(key) ?? defaults[key]]));
    view = "admin";
  } else {
    // The plain QA account only says released or not. Not released keeps the registry default,
    // unless that default is Everyone, which would contradict the live view, so it becomes Off.
    modes = localFlagModes(defaults, live);
    for (const [key, mode] of Object.entries(modes)) if (mode === "EVERYONE" && live[key] !== true) modes[key] = "OFF";
    view = "plain-qa";
  }
  return { source: SNAPSHOT_SOURCE, view, capturedAt: now.toISOString(), modes: sorted(modes) };
}

export const serialize = (snapshot) => `${JSON.stringify({ ...snapshot, modes: sorted(snapshot.modes) }, null, 2)}\n`;

export function addMissingDefaults(snapshot, defaults) {
  const added = Object.fromEntries(Object.entries(defaults).filter(([key]) => !(key in snapshot.modes)));
  return { ...snapshot, modes: sorted({ ...added, ...snapshot.modes }) };
}

export function snapshotProblems(snapshot, defaults, now = new Date()) {
  const problems = [];
  if (snapshot?.source !== SNAPSHOT_SOURCE) problems.push(`source must be ${SNAPSHOT_SOURCE}`);
  const captured = Date.parse(snapshot?.capturedAt);
  if (!Number.isFinite(captured)) problems.push("capturedAt is missing or not a date");
  else if (now.getTime() - captured > MAX_AGE_DAYS * 86_400_000) {
    problems.push(`capturedAt ${snapshot.capturedAt} is older than ${MAX_AGE_DAYS} days: run node scripts/flags/production-flag-modes.mjs --write`);
  }
  const modes = snapshot?.modes ?? {};
  for (const [key, mode] of Object.entries(modes)) {
    if (!KEY.test(key) || !MODES.includes(mode)) problems.push(`invalid entry ${key}=${mode}`);
  }
  const missing = Object.keys(defaults).filter((key) => !(key in modes));
  if (missing.length) {
    problems.push(`missing flags: ${missing.join(", ")}. Run node scripts/flags/production-flag-modes.mjs --add-defaults (or --write where live modes can be read)`);
  }
  if (JSON.stringify(Object.keys(modes)) !== JSON.stringify(Object.keys(sorted(modes)))) {
    problems.push("modes are not sorted by key (generated file, do not hand edit)");
  }
  return problems;
}

export function modeDifferences(snapshot, liveSnapshot) {
  return Object.keys(liveSnapshot.modes).sort()
    .filter((key) => snapshot.modes[key] !== liveSnapshot.modes[key])
    .map((key) => `${key}: file ${snapshot.modes[key] ?? "missing"}, live ${liveSnapshot.modes[key]}`);
}

export async function readLive(env = process.env, fetcher = fetch) {
  const token = env.AGENT_TOKEN || env.HYPERTASKS_JWT_TOKEN;
  if (token) {
    const response = await fetcher(SNAPSHOT_SOURCE, {
      headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Cannot read live flag modes (${response.status})`);
    const { flags } = await response.json();
    if (!Array.isArray(flags) || !flags.every((flag) => KEY.test(flag.key) && MODES.includes(flag.mode))) {
      throw new Error("Invalid live flag modes");
    }
    return flags;
  }
  return readPlainQaFlags();
}

async function main(argv, root) {
  const file = path.join(root, SNAPSHOT_PATH);
  const read = () => JSON.parse(readFileSync(file, "utf8"));
  const defaults = definitionDefaults(root);
  const mode = argv.find((arg) => ["--write", "--add-defaults", "--check", "--check-live"].includes(arg));
  if (mode === "--write") {
    writeFileSync(file, serialize(buildSnapshot(defaults, await readLive())));
    console.log(`Wrote ${SNAPSHOT_PATH} (${Object.keys(defaults).length} flags)`);
  } else if (mode === "--add-defaults") {
    writeFileSync(file, serialize(addMissingDefaults(read(), defaults)));
    console.log(`Updated ${SNAPSHOT_PATH}`);
  } else if (mode === "--check" || mode === "--check-live") {
    const snapshot = read();
    const problems = snapshotProblems(snapshot, defaults);
    if (mode === "--check-live") problems.push(...modeDifferences(snapshot, buildSnapshot(defaults, await readLive())));
    if (problems.length) {
      console.error(problems.join("\n"));
      process.exit(1);
    }
    console.log(`${SNAPSHOT_PATH} is complete (${Object.keys(defaults).length} flags)`);
  } else {
    console.error("usage: production-flag-modes.mjs --write | --add-defaults | --check | --check-live");
    process.exit(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2), path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));
}
