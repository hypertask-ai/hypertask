import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isolatedCjsTests } from "./test-isolation.mjs";

const STATIC_HAZARDS = [
  /(?:delete\s+)?process\.env\s*(?:\[[^\]]+\]|\.[A-Za-z0-9_]+)\s*=[^=]/,
  /delete\s+process\.env\b/,
  /Object\.(?:assign|defineProperty)\s*\(\s*process\.env\b/,
  /Reflect\.set\s*\(\s*process\.env\b/,
  /process\.env\s*=\s*[^=]/,
  /(?:const|let|var)\s+[A-Za-z0-9_$]+\s*=\s*process\.env\b/,
  /process\.(?:on|once|off|addListener|prependListener|removeListener|removeAllListeners)\s*\(/,
  /process\.(?:setUncaughtExceptionCaptureCallback|setUnhandledRejectionCaptureCallback)\s*\(/,
  /process\.(?:exit|chdir|umask)\s*\(/,
  /process\.(?:kill|abort)\s*\(/,
  /process\.(?:exitCode|title)\s*=[^=]/,
  /process\.(?:stdout|stderr)\s*(?:\[[^\]]+\]|\.[A-Za-z0-9_$]+)\s*=[^=]/,
  /process\.(?:stdout|stderr)\.(?:on|once|addListener|prependListener)\s*\(/,
  /(?:delete\s+)?(?:globalThis|global)\s*(?:\[[^\]]+\]|\.[A-Za-z0-9_$]+)\s*=[^=]/,
  /delete\s+(?:globalThis|global)\s*(?:\[|\.)/,
  /Object\.(?:assign|defineProperty)\s*\(\s*(?:globalThis|global|process)\b/,
  /\b(?:Date|Array|String|Number|Boolean|Object|JSON|Math|Promise|RegExp|Function|Error|Buffer)\.(?:prototype\.)?[A-Za-z0-9_$]+\s*=[^=]/,
  /\bconsole\.[A-Za-z0-9_$]+\s*=[^=]/,
  /\b(?:Module|require)\.(?:_load|_resolveFilename|_extensions)\s*=[^=]/,
  /\.(?:_load|_resolveFilename|_extensions)\s*=[^=]/,
  /\brequire\.cache/,
  /\._compile\s*\(/,
  /\bmock\.(?:method|module|reset|restore|timers|fn|getter|setter|property)\b/,
  /\.listen\s*\(/,
];

const HELPER_SOURCE = /\.(?:cjs|mjs|js|ts)$/;
const PRELOADED_HELPERS = new Set(["tests/helpers/register-server-only.cjs"]);

export function needsOwnProcess(file, source, hazardousHelpers = []) {
  if (isolatedCjsTests.has(file)) return true;
  if (typeof source !== "string") return false;
  if (STATIC_HAZARDS.some((pattern) => pattern.test(source))) return true;
  return hazardousHelpers.some((helper) => source.includes(helper) || source.includes(helper.replace(/^tests\//, "")));
}

export async function hazardousHelpers(root) {
  const directory = path.join(root, "tests", "helpers");
  let entries;
  try {
    entries = await readdir(directory, { recursive: true });
  } catch {
    return [];
  }
  const helpers = [];
  for (const entry of entries) {
    const name = String(entry).split(path.sep).join("/");
    if (!HELPER_SOURCE.test(name)) continue;
    const relative = `tests/helpers/${name}`;
    if (PRELOADED_HELPERS.has(relative)) continue;
    const source = await readFile(path.join(directory, name), "utf8").catch(() => null);
    if (source === null) continue;
    if (STATIC_HAZARDS.some((pattern) => pattern.test(source))) helpers.push(relative);
  }
  return helpers;
}

export async function classifySuite({ root, files }) {
  const serial = [];
  const pool = [];
  const safe = [];
  const weights = new Map();
  const helpers = await hazardousHelpers(root);
  for (const file of files) {
    if (isolatedCjsTests.has(file)) {
      serial.push(file);
      continue;
    }
    const source = await readFile(path.join(root, file), "utf8");
    weights.set(file, source.length);
    if (needsOwnProcess(file, source, helpers)) pool.push(file);
    else safe.push(file);
  }
  return { serial, pool, safe, weightOf: (file) => weights.get(file) ?? 1 };
}

export const LANE_BATCH = { maxFiles: 20, maxBytes: 100_000, concurrentFiles: 2 };

export function positiveInt(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${name} must be a positive integer, got ${value}`);
  return number;
}

export function batchLaneFiles(files, { maxFiles = Infinity, maxBytes = Infinity, weightOf = () => 1 } = {}) {
  const fileCap = maxFiles === Infinity ? Infinity : positiveInt(maxFiles, "maxFiles");
  const byteCap = maxBytes === Infinity ? Infinity : positiveInt(maxBytes, "maxBytes");
  const batches = [];
  let batch = [];
  let bytes = 0;
  for (const file of files) {
    const weight = Math.max(1, weightOf(file));
    if (batch.length > 0 && (batch.length >= fileCap || bytes + weight > byteCap)) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(file);
    bytes += weight;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

export function partitionSafeFiles(files, lanes, weightOf = () => 1) {
  const count = Math.max(1, Math.min(lanes, files.length || 1));
  const buckets = Array.from({ length: count }, () => ({ files: [], weight: 0 }));
  const ordered = [...files].sort((a, b) => weightOf(b) - weightOf(a) || a.localeCompare(b));
  for (const file of ordered) {
    const target = buckets.reduce((lowest, bucket) => (bucket.weight < lowest.weight ? bucket : lowest));
    target.files.push(file);
    target.weight += weightOf(file);
  }
  return buckets.filter((bucket) => bucket.files.length > 0).map((bucket) => bucket.files.sort());
}
