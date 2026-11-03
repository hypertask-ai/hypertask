import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FAMILIES = (process.env.VISUAL_FONT_FAMILIES ?? "IBM Plex Sans,ui-sans-serif,system-ui,sans-serif,serif,monospace,emoji")
  .split(",").map(family => family.trim()).filter(Boolean);
const CONFIG_DIRS = (process.env.VISUAL_FONTCONFIG_DIRS ?? "/etc/fonts").split(/\s+/).filter(Boolean);

export function digest(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function fileDigest(file, subject) {
  let text;
  try {
    text = readFileSync(file);
  } catch {
    throw new Error(`fontconfig resolved ${subject} to ${file}, which is not readable, so no saved screen can be proven to match this image`);
  }
  return digest(text);
}

export function resolvedFonts(families = FAMILIES) {
  return families.map(family => {
    let file;
    try {
      file = execFileSync("fc-match", ["-f", "%{file}", family], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      throw new Error(`fontconfig could not resolve "${family}", so no saved screen can be proven to match this image`);
    }
    if (!file) throw new Error(`fontconfig resolved no font file for "${family}", so no saved screen can be proven to match this image`);
    return `${family} ${fileDigest(file, `"${family}"`)}`;
  });
}

export function fontConfigFiles(directories = CONFIG_DIRS) {
  const found = [];
  function walk(directory) {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile()) found.push(fileDigest(target, "their fontconfig"));
    }
  }
  for (const directory of directories) walk(directory);
  return found.sort();
}

export function fontFingerprint() {
  return digest([...resolvedFonts(), ...fontConfigFiles()].join("\n"));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.stdout.write(`fonts=${fontFingerprint()}\n`);
}
