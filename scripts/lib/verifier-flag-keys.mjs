import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FLAG_DEFINITIONS_DIR = "src/lib/flags/definitions";
const LEGACY_KEY_FILES = ["src/lib/flags/keys.ts", "src/lib/flags.ts"];
const SOURCE_FILE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const EXPORTED_KEY_CONSTANT = /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*["'`]([^"'`]+)["'`]/g;

function flagKeyPattern() {
  return /\b(?:htpr|hyfa|yper4)-\d+-[a-z0-9-]+/g;
}

function definitionFileNames(root, readdir) {
  let names = [];
  try {
    names = readdir(path.join(root, FLAG_DEFINITIONS_DIR));
  } catch {
    names = [];
  }
  return names.filter((name) => name.endsWith(".ts") && name !== "index.generated.ts");
}

export function registeredFlagKeys(root, { readFile = readFileSync, readdir = readdirSync } = {}) {
  const keys = new Set();
  for (const name of definitionFileNames(root, readdir)) keys.add(name.slice(0, -".ts".length));
  for (const file of LEGACY_KEY_FILES) {
    let text;
    try {
      text = readFile(path.join(root, file), "utf8");
    } catch {
      continue;
    }
    for (const match of String(text).matchAll(flagKeyPattern())) keys.add(match[0]);
  }
  return [...keys].sort();
}

export function flagIdentifiers(root, { readFile = readFileSync, readdir = readdirSync } = {}) {
  const registered = new Set(registeredFlagKeys(root, { readFile, readdir }));
  const identifiers = new Map();
  const sources = definitionFileNames(root, readdir).map((name) => path.join(root, FLAG_DEFINITIONS_DIR, name));
  sources.push(...LEGACY_KEY_FILES.map((file) => path.join(root, file)));
  for (const file of sources) {
    let text;
    try {
      text = readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const match of String(text).matchAll(EXPORTED_KEY_CONSTANT)) {
      if (registered.has(match[2])) identifiers.set(match[1], match[2]);
    }
  }
  return identifiers;
}

export function keysFromIdentifiers(text, identifiers) {
  const found = new Set();
  const source = String(text ?? "");
  for (const [identifier, key] of identifiers) {
    if (new RegExp(`(?<![\\w$.])${identifier}(?![\\w$])`).test(source)) found.add(key);
  }
  return found;
}

export function registeredKeysInText(text, registered) {
  const found = new Set();
  for (const match of String(text ?? "").matchAll(flagKeyPattern())) {
    if (registered.has(match[0])) found.add(match[0]);
  }
  return found;
}

function safeRelativeFile(file) {
  const value = String(file ?? "");
  if (!value || value.startsWith("/") || value.includes("\\")) return "";
  const parts = value.split("/");
  if (parts.some((part) => part === ".." || part === "" || part === ".")) return "";
  return value;
}

export function flagKeysForPlan(plan, { root, readFile = readFileSync, readdir = readdirSync } = {}) {
  const registered = new Set(registeredFlagKeys(root, { readFile, readdir }));
  const identifiers = flagIdentifiers(root, { readFile, readdir });
  const keys = new Set();
  const collect = (text) => {
    for (const key of registeredKeysInText(text, registered)) keys.add(key);
    for (const key of keysFromIdentifiers(text, identifiers)) keys.add(key);
  };
  collect(plan?.claim?.diff);
  const files = Array.isArray(plan?.files) ? plan.files : [];
  for (const file of files) {
    const relative = safeRelativeFile(file);
    if (!relative || !SOURCE_FILE.test(relative)) continue;
    let text;
    try {
      text = readFile(path.join(root, relative), "utf8");
    } catch {
      continue;
    }
    collect(text);
  }
  return [...keys].sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const planFlag = process.argv.indexOf("--plan");
  const candidateFlag = process.argv.indexOf("--candidate");
  if (planFlag === -1 || candidateFlag === -1) {
    console.error("usage: verifier-flag-keys.mjs --plan <plan.json> --candidate <root>");
    process.exit(2);
  }
  const plan = JSON.parse(readFileSync(process.argv[planFlag + 1], "utf8"));
  console.log(flagKeysForPlan(plan, { root: path.resolve(process.argv[candidateFlag + 1]) }).join(","));
}
