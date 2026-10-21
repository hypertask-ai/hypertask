import { open, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const snapshotLimit = 45000;
const recordLimit = 262144;
const keyPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const modes = ["OFF", "OWNER_ONLY", "OWNER_AND_QA", "EVERYONE"];

// Bound reads before allocation and refuse links, devices and FIFOs from artifacts.
export async function readBounded(file, limit) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) throw new Error("Oversized or unsafe input file");
    const buffer = Buffer.alloc(limit + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > limit) throw new Error("Oversized input file");
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally { await handle.close(); }
}

export function guardPull(pr, repository, expectedSha) {
  if (pr?.state !== "open" || pr.base?.ref !== "production" || pr.base?.repo?.full_name !== repository) {
    throw new Error("Expected an open PR targeting this repository's production branch");
  }
  if (pr.head?.repo?.full_name !== repository) throw new Error("Fork PRs cannot run premerge clicks");
  if (!/^[0-9a-f]{40}$/.test(pr.head?.sha)) throw new Error("Invalid PR head SHA");
  if (expectedSha !== undefined && pr.head.sha !== expectedSha) throw new Error("PR head moved during the click");
  return pr.head.sha;
}

export function snapshotModes(snapshot, defaults) {
  const map = snapshot?.modes;
  const plain = snapshot?.plain;
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  if (!object(snapshot) || JSON.stringify(snapshot).length > snapshotLimit ||
      Object.keys(snapshot).sort().join(",") !== "modes,plain" || !object(map) || !object(plain) ||
      !Object.keys(map).length || Object.keys(map).length > 1000 ||
      !Object.entries(map).every(([key, mode]) => key.length <= 160 && keyPattern.test(key) && modes.includes(mode)) ||
      !Object.keys(plain).length || Object.keys(plain).length > 1000 ||
      !Object.entries(plain).every(([key, value]) => key.length <= 160 && keyPattern.test(key) && typeof value === "boolean")) {
    throw new Error("Invalid live flag-modes snapshot");
  }
  // The plain account sees Everyone only. Never silently narrow a released flag.
  for (const [key, released] of Object.entries(plain)) {
    if (released && map[key] !== "EVERYONE") throw new Error("Cannot narrow an Everyone flag from the plain live view");
  }
  return defaults === undefined ? map : { ...defaults, ...map };
}

export function decodeSnapshot(encoded) {
  if (typeof encoded !== "string" || encoded.length > 60000 || encoded.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error("Invalid or oversized encoded flag snapshot");
  }
  const snapshot = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  snapshotModes(snapshot);
  return snapshot;
}

export function guardClickPath(value) {
  if (typeof value !== "string" || value.length > 1024 || !/^[a-zA-Z0-9_./-]+\.mjs$/.test(value) ||
      !value.endsWith(".mjs") || value.startsWith("/") || value.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error("Click script must be a repository-relative .mjs path without traversal");
  }
  return value;
}

export async function resolveClickPath(checkoutRoot, value) {
  guardClickPath(value);
  const root = await realpath(checkoutRoot);
  const resolved = await realpath(path.join(root, value));
  if (!resolved.startsWith(root + path.sep) || !resolved.endsWith(".mjs") || !(await stat(resolved)).isFile()) {
    throw new Error("Click script escapes PR checkout or is not an .mjs file");
  }
  return resolved;
}

export async function validateEvidence(folder, sha, snapshot, expectedClick) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("Invalid evidence SHA");
  const root = await realpath(folder);
  const text = await readBounded(path.join(root, "premerge.md"), recordLimit);
  const fields = {};
  for (const key of ["Commit", "Account", "Flags", "Board", "Build", "Click", "Recording"]) {
    const matches = text.split(/\r?\n/).filter(line => line.startsWith(`${key}:`));
    if (matches.length !== 1 || !matches[0].slice(key.length + 1).trim()) throw new Error(`Missing or duplicate ${key}`);
    fields[key] = matches[0].slice(key.length + 1).trim();
  }
  if (fields.Commit !== sha || fields.Account !== "985 (disposable QA, board owner)" || !fields.Click.startsWith("PASS ")) {
    throw new Error("Click record does not prove this commit and QA account passed");
  }
  const click = guardClickPath(fields.Click.slice(5));
  if (expectedClick !== undefined && click !== guardClickPath(expectedClick)) throw new Error("Wrong click script recorded");
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/.test(fields.Build) ||
      !fields.Board.startsWith(`${fields.Build}/project?id=`) ||
      !/^[1-9][0-9]*&surface=board$/.test(fields.Board.slice(`${fields.Build}/project?id=`.length))) {
    throw new Error("Invalid disposable board/build URL");
  }
  const flags = {};
  for (const entry of fields.Flags.split(", ")) {
    const match = /^([a-z0-9]+(?:-[a-z0-9]+)*)=(OFF|OWNER_ONLY|OWNER_AND_QA|EVERYONE)$/.exec(entry);
    if (!match || Object.hasOwn(flags, match[1])) throw new Error("Invalid evidence Flags");
    flags[match[1]] = match[2];
  }
  for (const [key, mode] of Object.entries(snapshotModes(snapshot))) {
    if (flags[key] !== mode) throw new Error("Click flags differ from dispatch snapshot");
  }
  const media = async (relative, extension) => {
    if (path.isAbsolute(relative) || relative.split("/").includes("..") || !extension.test(relative)) throw new Error("Invalid recording or screenshot path");
    const resolved = await realpath(path.join(root, relative));
    const info = await stat(resolved);
    if (!resolved.startsWith(root + path.sep) || !info.isFile() || info.size === 0 || info.size > 134217728) {
      throw new Error("Missing or unsafe recording/screenshot");
    }
  };
  await media(fields.Recording, /\.webm$/);
  await media("screenshots/after.png", /\.png$/);
  return fields;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === "pull" && (args.length === 2 || args.length === 3)) {
      console.log(guardPull(JSON.parse(await readBounded(args[0], 1048576)), args[1], args[2]));
    } else if (command === "flags" && args.length === 1) {
      snapshotModes(JSON.parse(await readBounded(args[0], snapshotLimit)));
    } else if (command === "decode-flags" && args.length === 0) {
      console.log(JSON.stringify(decodeSnapshot(process.env.FLAGS)));
    } else if (command === "path" && args.length === 1) {
      guardClickPath(args[0]);
    } else if (command === "evidence" && args.length === 3) {
      await validateEvidence(args[0], args[1], JSON.parse(await readBounded(args[2], snapshotLimit)));
    } else throw new Error("Usage: premerge-click-guard.mjs pull <json> <repo> [sha] | flags <json> | decode-flags | path <click.mjs> | evidence <folder> <sha> <flags>");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
