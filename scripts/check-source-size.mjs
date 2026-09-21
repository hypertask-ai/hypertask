#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MAX_LINES = 1500;
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const STATIC_DATA_FILE = /(?:^|\/)(?:constants|fixtures|generated)\/.*(?:Data|data)?\.[cm]?[jt]sx?$/;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function addedSourceFiles() {
  const explicitBase = process.env.SOURCE_SIZE_BASE_REF;
  const githubBase = process.env.GITHUB_BASE_REF
    ? `origin/${process.env.GITHUB_BASE_REF}`
    : null;
  const base = explicitBase || githubBase || "HEAD^";
  let committed = "";

  try {
    committed = git(["diff", "--name-only", "--diff-filter=A", `${base}...HEAD`]);
  } catch {
    committed = git(["diff", "--name-only", "--diff-filter=A", "HEAD^"]);
  }

  const untracked = git(["ls-files", "--others", "--exclude-standard"]);
  return [...new Set(`${committed}\n${untracked}`.split("\n"))]
    .filter(Boolean)
    .filter((file) => SOURCE_FILE.test(file));
}

const files = process.argv.slice(2).length > 0 ? process.argv.slice(2) : addedSourceFiles();
const oversized = files.flatMap((file) => {
  if (STATIC_DATA_FILE.test(file)) return [];
  const lines = readFileSync(file, "utf8").split(/\r?\n/).length;
  return lines > MAX_LINES ? [{ file, lines }] : [];
});

if (oversized.length > 0) {
  for (const { file, lines } of oversized) {
    console.error(`${file}: ${lines} lines exceeds the ${MAX_LINES}-line source limit`);
  }
  process.exit(1);
}

console.log(`Source size check passed for ${files.length} new source file(s).`);
