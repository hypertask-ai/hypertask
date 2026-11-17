#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const mapFolder = ".claude/skills/verify-qa/reference/feature-map";
export const enforcedTags = ["FEATURE", "IMPROVE"];

const USER_FACING = /^src\/(?:app|components)\//;
const TEST_LIKE = /(?:^|\/)(?:__tests__|__fixtures__|__mocks__)\/|\.(?:test|spec|stories)\.[cm]?[jt]sx?$/;
const SOURCE_LIKE = /\.[cm]?[jt]sx?$|\.(?:css|scss)$/;

export function tagOf(title) {
  const match = /^\S+\s+\[([^\]]+)\]/.exec(title ?? "");
  return match ? match[1] : null;
}

export function isUserFacing(file) {
  return USER_FACING.test(file) && !TEST_LIKE.test(file) && SOURCE_LIKE.test(file);
}

export function areaOf(file) {
  return file.split("/").slice(0, 3).join("/");
}

export function citedPaths(markdown) {
  const cited = new Set();
  for (const match of markdown.matchAll(/`([^`\n]+)`/g)) {
    const token = match[1].trim().split(/\s+/)[0].replace(/#.*$/, "").replace(/[.,;:!?)]+$/, "").replace(/\/$/, "");
    if (/^src\//.test(token) && !/[<*>?{}]/.test(token)) cited.add(token);
  }
  return cited;
}

function citesArea(cited, area, files) {
  const areaFiles = files.filter((file) => areaOf(file) === area);
  for (const token of cited) {
    if (token === area || areaFiles.includes(token)) return true;
  }
  return false;
}

export function evaluate({ title, changedFiles, mapPages }) {
  const tag = tagOf(title);
  if (!enforcedTags.includes(tag)) return { tag, enforced: false, ok: true, reasons: [], areas: [] };
  const files = [...new Set(changedFiles)].filter(isUserFacing);
  if (!files.length) return { tag, enforced: true, ok: true, reasons: [], areas: [] };
  const areas = [...new Set(files.map(areaOf))].sort();
  const pages = (mapPages ?? []).filter((page) => page.status !== "D" && page.path.endsWith(".md") && page.path !== `${mapFolder}/INDEX.md` && !page.path.startsWith(`${mapFolder}/rows/`));
  const cited = pages.flatMap((page) => [...citedPaths(page.text)]);
  const uncovered = areas.filter((area) => !citesArea(new Set(cited), area, files));
  const reasons = [];
  if (!pages.length) reasons.push("no feature-map page was added or edited");
  if (uncovered.length) reasons.push(`uncovered areas: ${uncovered.join(", ")}`);
  return { tag, enforced: true, ok: reasons.length === 0, reasons, areas, pages: pages.map((page) => page.path) };
}

export function formatFailure(result) {
  const lines = [
    `[${result.tag}] pull requests that change user-facing files must add or edit a feature-map page for each area they touch.`,
    `Map folder: ${mapFolder}/`,
    ...result.reasons.map((reason) => `Problem: ${reason}.`),
    "Fix: edit the existing page for that area, or add a page and cite the changed path in backticks, then list the page in INDEX.md.",
  ];
  return lines.join("\n");
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

export function readChange(base, head, cwd = process.cwd()) {
  const ancestor = git(["merge-base", base, head], cwd).trim();
  const rows = git(["diff", "--name-status", "--no-renames", "-z", ancestor, head], cwd).split("\0").filter(Boolean);
  const changed = [];
  for (let index = 0; index + 1 < rows.length; index += 2) changed.push({ status: rows[index].slice(0, 1), path: rows[index + 1] });
  const mapPages = changed
    .filter((entry) => entry.path.startsWith(`${mapFolder}/`))
    .map((entry) => ({
      status: entry.status,
      path: entry.path,
      text: entry.status === "D" ? "" : git(["show", `${head}:${entry.path}`], cwd),
    }));
  return { changedFiles: changed.map((entry) => entry.path), mapPages };
}

export function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const [base, head, title] = argv;
  if (!base || !head) throw new Error("usage: feature-map-change-guard.mjs <base-sha> <head-sha> [pr-title]");
  const change = readChange(base, head, cwd);
  const result = evaluate({ title, ...change });
  if (!result.enforced) {
    process.stdout.write("feature-map change guard: tag not enforced; nothing to check.\n");
    return 0;
  }
  if (result.ok) {
    process.stdout.write(`feature-map change guard: ok (${result.areas.length ? result.areas.join(", ") : "no user-facing files"}).\n`);
    return 0;
  }
  process.stdout.write(`${formatFailure(result)}\n`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stdout.write(`feature-map change guard: could not read the change: ${error.message}\n`);
    process.exitCode = 1;
  }
}
