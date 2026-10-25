#!/usr/bin/env node
/**
 * Generates an allowlist of test files that read source files as text and regex-match them.
 * These tests assert implementation, not behavior, so they break on harmless refactors.
 * The allowlist may only shrink - adding new entries is blocked by the CI check.
 */
import { writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { findOffenders } from "./lib/source-text-regex-detector.cjs";

const root = process.cwd();
const allowlist = findOffenders(root);
const outputPath = join(root, "tests/source-text-regex-allowlist.json");

writeFileSync(
  outputPath,
  JSON.stringify({ allowlist, count: allowlist.length }, null, 2) + "\n"
);

console.log(`Generated allowlist with ${allowlist.length} test files.`);
console.log(`Saved to: ${relative(root, outputPath)}`);
process.stdout.write(`${allowlist.length}\n`);
