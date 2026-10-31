#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Generated route types depend only on these inputs: the route surface under the
// App and Pages routers, the Next config, middleware and the locked Next version.
const SURFACE_PATHS = [
  "src/app",
  "src/pages",
  "next.config.js",
  "next.config.mjs",
  "src/middleware.ts",
  "src/proxy.ts",
  "package-lock.json",
];

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

// A content digest of the route surface, built from git's own blob ids so no
// route file is read and a dirty worktree cannot fake a match.
export function routeSurface(workspace = process.cwd(), run = git) {
  const listing = run(["ls-files", "-s", "--", ...SURFACE_PATHS], workspace);
  const entries = [];
  for (const line of listing.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const blob = line.slice(0, tab).split(/\s+/)[1];
    if (!blob) continue;
    entries.push(`${line.slice(tab + 1)}:${blob}`);
  }
  if (entries.length === 0) return null;
  entries.sort();
  return createHash("sha256").update(entries.join("\n")).digest("hex").slice(0, 40);
}

export function matchesCachedSurface(file, surface) {
  if (!surface) return false;
  try {
    return readFileSync(file, "utf8").trim() === surface;
  } catch {
    return false;
  }
}

export function writeCachedSurface(file, surface) {
  if (!surface) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${surface}\n`);
  return true;
}

function main(argv) {
  const [command, target] = argv;
  let surface;
  try {
    surface = routeSurface();
  } catch (error) {
    console.error(`route surface unavailable: ${error.message}`);
    process.exit(1);
  }
  if (!surface) {
    console.error("route surface unavailable: no tracked route files");
    process.exit(1);
  }
  if (command === "--match" && target) {
    process.exit(matchesCachedSurface(target, surface) ? 0 : 1);
  }
  if (command === "--write" && target) {
    writeCachedSurface(target, surface);
  } else if (command) {
    console.error(`unknown command: ${command}`);
    process.exit(2);
  }
  process.stdout.write(`${surface}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
