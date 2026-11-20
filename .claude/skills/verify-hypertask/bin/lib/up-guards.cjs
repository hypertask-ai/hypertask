const { lstatSync, realpathSync } = require("node:fs");
const path = require("node:path");

const fatalLines = [
  /Turbopack build encountered \d+ error/,
  /Could not find the Next\.js package/,
  /Cannot find module/,
  /EADDRINUSE/,
  /Error: Module not found/,
];

function escapingSymlink(linkPath, rootPath) {
  let stat;
  try {
    stat = lstatSync(linkPath);
  } catch {
    return null;
  }
  if (!stat.isSymbolicLink()) return null;
  let target = null;
  try {
    target = realpathSync(linkPath);
  } catch {
    target = null;
  }
  let root;
  try {
    root = realpathSync(rootPath);
  } catch {
    return target || linkPath;
  }
  if (target && (target === root || target.startsWith(`${root}${path.sep}`))) return null;
  return target || linkPath;
}

function fatalLine(text) {
  for (const line of String(text || "").split("\n")) {
    if (fatalLines.some((pattern) => pattern.test(line))) return line.trim();
  }
  return null;
}

module.exports = { escapingSymlink, fatalLine };
