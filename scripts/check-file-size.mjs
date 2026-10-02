#!/usr/bin/env node
// Fails when a tracked source file under src/ is over MAX_LINES lines.
// Static data files are exempt. HTPR-6506.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const MAX_LINES = 1500;

// Static data only. Logic never goes on this list: split the file instead.
export const STATIC_DATA = new Set(["src/lib/constants/emojiData.ts"]);

const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

export function countLines(text) {
  if (text.length === 0) return 0;
  const lines = text.split("\n").length;
  return text.endsWith("\n") ? lines - 1 : lines;
}

export function findOversized(root = process.cwd()) {
  const files = execFileSync("git", ["ls-files", "-z", "src"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter((file) => SOURCE.test(file) && !STATIC_DATA.has(file));

  return files
    .map((file) => ({
      file,
      lines: countLines(readFileSync(`${root}/${file}`, "utf8")),
    }))
    .filter(({ lines }) => lines > MAX_LINES)
    .sort((a, b) => b.lines - a.lines);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const oversized = findOversized();
  if (oversized.length > 0) {
    console.error(`Source files over ${MAX_LINES} lines (split them):`);
    for (const { file, lines } of oversized) console.error(`- ${file}: ${lines}`);
    process.exit(1);
  }
  console.log(`file size ok: no source file under src/ is over ${MAX_LINES} lines`);
}
