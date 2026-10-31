#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const LEDGER_BASENAMES = new Set(["gates.md", ".unlazy-hook-state.json"]);
const LEDGER_DIRECTORIES = new Set([".unlazy"]);

export function isSessionLedger(file) {
  const parts = file.split("/").filter(Boolean);
  if (!parts.length) return false;
  if (LEDGER_BASENAMES.has(parts.at(-1).toLowerCase())) return true;
  return parts.slice(0, -1).some(part => LEDGER_DIRECTORIES.has(part.toLowerCase()));
}

export function findSessionLedgers(files) {
  return files.filter(isSessionLedger);
}

function gitFiles(args) {
  const output = execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return output.split("\0").filter(Boolean);
}

export function listFiles(rev) {
  return rev
    ? gitFiles(["ls-tree", "-r", "-z", "--name-only", rev])
    : gitFiles(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
}

const FIX = `A session ledger is private working state, not a repository file.
Keep the ledger outside the worktree, for example:
  mkdir -p "$HOME/.unlazy/ledgers/HTPR-1234"
  write "$HOME/.unlazy/ledgers/HTPR-1234/GATES.md"
Point the gate tools at that path:
  node ~/.agents/skills/unlazy/scripts/gate-check.mjs --status "$HOME/.unlazy/ledgers/HTPR-1234/GATES.md"
Remove the ledger from this change:
  tracked:   git rm --cached <path>   (commit the removal)
  untracked: rm <path>`;

function usage() {
  console.error("usage: node scripts/check-session-ledgers.mjs [--rev <rev>]");
  process.exit(2);
}

function main(argv) {
  let rev = "";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--rev") {
      rev = argv[index + 1] ?? "";
      index += 1;
      if (!rev || rev.startsWith("-")) usage();
    } else if (arg === "--help" || arg === "-h") {
      console.log("usage: node scripts/check-session-ledgers.mjs [--rev <rev>]");
      return 0;
    } else {
      usage();
    }
  }

  let files;
  try {
    files = listFiles(rev);
  } catch (error) {
    console.error(`session-ledger guard: cannot list ${rev ? `the tree of ${rev}` : "the worktree"}: ${error.message}`);
    return 2;
  }

  const ledgers = findSessionLedgers(files);
  if (!ledgers.length) {
    console.log(`session-ledger guard: clean, ${files.length} files checked`);
    return 0;
  }

  console.error(`session-ledger guard: FAILED, ${ledgers.length} session ledger file(s) in ${rev ? `revision ${rev}` : "this change"}`);
  for (const ledger of ledgers) console.error(`  ${ledger}`);
  console.error("");
  console.error(FIX);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
