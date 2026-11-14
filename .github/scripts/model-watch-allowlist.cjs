const fs = require("node:fs");
const path = require("node:path");
const { identity } = require("../../scripts/model-diff");

const ALLOWLIST = path.join(__dirname, "model-watch.allowlist.json");
const VERSION = /^\d+(?:\.\d+)*$/;

function readAllowlist(file = ALLOWLIST) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const watch = parsed.watch;
  if (!watch || typeof watch !== "object" || Array.isArray(watch)) throw new Error("Model watch allowlist needs a watch object");
  for (const [provider, families] of Object.entries(watch)) {
    if (!families || typeof families !== "object" || Array.isArray(families) || !Object.keys(families).length) {
      throw new Error(`Model watch allowlist: ${provider} needs at least one family version`);
    }
    for (const [family, floor] of Object.entries(families)) {
      if (typeof floor !== "string" || !VERSION.test(floor)) {
        throw new Error(`Model watch allowlist: ${provider}/${family} needs a version such as "5.5"`);
      }
    }
  }
  return watch;
}

function versionAtLeast(version, floor) {
  const atLeast = floor.split(".").map(Number);
  for (let index = 0; index < Math.max(version.length, atLeast.length); index++) {
    const difference = (version[index] ?? 0) - (atLeast[index] ?? 0);
    if (difference) return difference > 0;
  }
  return true;
}

function watched(finding, watch) {
  if (finding.kind !== "new-class") return true;
  const families = watch[finding.provider];
  if (!families) return false;
  const model = identity(finding.model);
  return families[model.family] !== undefined && versionAtLeast(model.version, families[model.family]);
}

function selectWatched(findings, watch = readAllowlist()) {
  const kept = [];
  const skipped = [];
  for (const finding of findings) (watched(finding, watch) ? kept : skipped).push(finding);
  return { kept, skipped };
}

function worthFiling(findings) {
  return findings.some((finding) => finding.kind !== "new-class" || !(finding.inputPerMillion > 5));
}

module.exports = { ALLOWLIST, readAllowlist, versionAtLeast, watched, selectWatched, worthFiling };
