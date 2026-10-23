const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

function badVersionIndex(list) {
  const index = new Map();
  for (const [incident, { versions }] of Object.entries(list)) {
    for (const [name, bad] of Object.entries(versions)) {
      for (const version of bad) index.set(`${name}@${version}`, incident);
    }
  }
  return index;
}

function packageName(lockPath, entry) {
  if (entry.name) return entry.name;
  const marker = "node_modules/";
  const at = lockPath.lastIndexOf(marker);
  return at === -1 ? null : lockPath.slice(at + marker.length);
}

function findKnownBadPackages(lockFile, lock, list) {
  if (!lock || typeof lock.packages !== "object") throw new Error(`${lockFile} has no "packages" map; regenerate it with npm 7 or newer so every installed version can be checked`);
  const index = badVersionIndex(list);
  const hits = [];
  for (const [lockPath, entry] of Object.entries(lock.packages)) {
    const name = packageName(lockPath, entry);
    const incident = name && index.get(`${name}@${entry.version}`);
    if (incident) hits.push(`${lockFile} ${lockPath || "(root)"}: ${name}@${entry.version} is a known-bad release (${incident}); pin the previous version`);
  }
  return hits;
}

if (require.main === module) {
  try {
    const list = JSON.parse(fs.readFileSync(".github/known-bad-packages.json", "utf8"));
    const lockFiles = execFileSync("git", ["ls-files", "package-lock.json", "**/package-lock.json"], { encoding: "utf8" }).split("\n").filter(Boolean);
    if (!lockFiles.length) throw new Error("no tracked package-lock.json found; refusing to pass an empty scan");
    const hits = lockFiles.flatMap(file => findKnownBadPackages(file, JSON.parse(fs.readFileSync(file, "utf8")), list));
    if (hits.length) throw new Error(hits.join("\n"));
    console.log(`Known-bad package guard passed: ${lockFiles.length} lockfiles clean`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { findKnownBadPackages };
