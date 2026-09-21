#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const MAX_LINES = 1500;
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const STATIC_DATA_FILE = /(?:^|\/)(?:constants|fixtures|generated)\/.*(?:Data|data)?\.[cm]?[jt]sx?$/;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function resolveBaseRef() {
  const configured = process.env.SOURCE_SIZE_BASE_REF;
  const candidates = [
    configured,
    process.env.GITHUB_BASE_REF && `origin/${process.env.GITHUB_BASE_REF}`,
    "hypertask-ai/production",
    "origin/production",
    "HEAD^",
  ].filter(Boolean);

  const base = candidates.find((candidate) => {
    try {
      git(["rev-parse", "--verify", candidate]);
      return true;
    } catch {
      return false;
    }
  });
  if (!base) {
    throw new Error(`Could not resolve a source-size base ref from: ${candidates.join(", ")}`);
  }
  return base;
}

function addedSourceFiles() {
  const base = resolveBaseRef();
  const committed = git([
    "diff",
    "--name-only",
    "--diff-filter=A",
    `${base}...HEAD`,
  ]);
  const staged = git(["diff", "--cached", "--name-only", "--diff-filter=A"]);
  const untracked = git(["ls-files", "--others", "--exclude-standard"]);
  return [...new Set(`${committed}\n${staged}\n${untracked}`.split("\n"))]
    .filter(Boolean)
    .filter((file) => SOURCE_FILE.test(file) && existsSync(file));
}

const files = process.argv.slice(2).length > 0 ? process.argv.slice(2) : addedSourceFiles();
const oversized = files.flatMap((file) => {
  if (STATIC_DATA_FILE.test(file)) return [];
  const source = readFileSync(file, "utf8");
  const newlineCount = source.match(/\n/g)?.length ?? 0;
  const lines = source.length === 0
    ? 0
    : newlineCount + (source.endsWith("\n") ? 0 : 1);
  return lines > MAX_LINES ? [{ file, lines }] : [];
});

if (oversized.length > 0) {
  for (const { file, lines } of oversized) {
    console.error(`${file}: ${lines} lines exceeds the ${MAX_LINES}-line source limit`);
  }
  process.exit(1);
}

console.log(`Source size check passed for ${files.length} new source file(s).`);
