import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const inventoryLine = /^Test inventory: (\d+) Node tests, (\d+) TypeScript tests\.$/gm;

export function partition(files, count) {
  const shardCount = Number(count);
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new Error(`CI_TEST_SHARDS must be a positive integer, got ${count}`);
  }
  const seen = new Set();
  const unique = [];
  for (const raw of files) {
    const file = String(raw).trim();
    if (!file) continue;
    if (seen.has(file)) throw new Error(`duplicate test file ${file}`);
    seen.add(file);
    unique.push(file);
  }
  unique.sort();
  const shards = Array.from({ length: shardCount }, () => []);
  unique.forEach((file, index) => shards[index % shardCount].push(file));
  return shards;
}

export async function discoverSupportedTests() {
  const root = process.cwd();
  const { discoverTestFiles } = await import("../../scripts/test-inventory.mjs");
  const found = await discoverTestFiles({ root, testsRoot: path.join(root, "tests") });
  if (found.unsupported.length > 0) {
    throw new Error(`unsupported test files: ${found.unsupported.join(", ")}`);
  }
  return found.supported;
}

export async function writePartition(outDir, shards) {
  await mkdir(outDir, { recursive: true });
  const all = [...shards.flat()].sort();
  await writeFile(path.join(outDir, "all.txt"), all.length ? `${all.join("\n")}\n` : "");
  await Promise.all(shards.map((files, index) =>
    writeFile(path.join(outDir, `shard-${index}.txt`), files.length ? `${files.join("\n")}\n` : ""),
  ));
  const manifest = {
    count: shards.length,
    files: all.length,
    sizes: shards.map((files) => files.length),
  };
  await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest)}\n`);
  return manifest;
}

async function readLines(file) {
  const text = await readFile(file, "utf8");
  return text.split("\n").filter((line) => line.length > 0);
}

export async function readPartition(outDir) {
  const entries = await readdir(outDir);
  const names = entries.filter((name) => /^shard-\d+\.txt$/.test(name)).sort((a, b) =>
    Number(a.slice(6, -4)) - Number(b.slice(6, -4)));
  const shards = [];
  for (const name of names) {
    const index = Number(name.slice(6, -4));
    if (index !== shards.length) throw new Error(`missing shard-${shards.length}.txt in ${outDir}`);
    shards.push(await readLines(path.join(outDir, name)));
  }
  if (shards.length === 0) throw new Error(`no shard lists in ${outDir}`);
  const all = await readLines(path.join(outDir, "all.txt"));
  return { all, shards };
}

export function assertPartition(all, shards) {
  const expected = partition(all, shards.length);
  const flat = shards.flat();
  const seen = new Set();
  for (const file of flat) {
    if (seen.has(file)) throw new Error(`duplicate test file ${file}`);
    seen.add(file);
  }
  if (flat.length !== all.length || all.some((file) => !seen.has(file))) {
    throw new Error(`shard union ${flat.length} files, full set ${all.length} files`);
  }
  for (let index = 0; index < shards.length; index += 1) {
    if (shards[index].join("\n") !== expected[index].join("\n")) {
      throw new Error(`shard ${index} is not the count split`);
    }
  }
  return { files: all.length, sizes: shards.map((files) => files.length) };
}

export function inventoryCount(log) {
  const matches = [...String(log).matchAll(inventoryLine)];
  if (matches.length !== 1) {
    throw new Error(`expected one test inventory line, found ${matches.length}`);
  }
  return Number(matches[0][1]) + Number(matches[0][2]);
}

async function findShardArtifact(resultsDir, index) {
  const wanted = `shard-${index}`;
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const found = await walk(absolute);
        if (found) return found;
      }
    }
    const list = entries.find((entry) => entry.isFile() && entry.name === `${wanted}.txt`);
    const log = entries.find((entry) => entry.isFile() && entry.name === `${wanted}.log`);
    if (list && log) return { list: path.join(directory, list.name), log: path.join(directory, log.name) };
    return null;
  }
  return walk(resultsDir);
}

export async function proveResults(plannedDir, resultsDir) {
  const planned = await readPartition(plannedDir);
  const summary = assertPartition(planned.all, planned.shards);
  for (let index = 0; index < planned.shards.length; index += 1) {
    const artifact = await findShardArtifact(resultsDir, index);
    if (!artifact) throw new Error(`missing shard ${index} artifact`);
    const ran = await readLines(artifact.list);
    if (ran.join("\n") !== planned.shards[index].join("\n")) {
      throw new Error(`shard ${index} ran a different file list`);
    }
    const log = await readFile(artifact.log, "utf8");
    const files = planned.shards[index];
    if (files.length === 0) {
      if (!log.includes(`shard ${index} empty`)) throw new Error(`shard ${index} was empty but did not say so`);
      continue;
    }
    const counted = inventoryCount(log);
    if (counted !== files.length) {
      throw new Error(`shard ${index} inventory ${counted} != ${files.length} files`);
    }
  }
  return summary;
}

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  return argv[index + 1];
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const argv = process.argv.slice(2);
  const outDir = argValue(argv, "--out");
  if (!outDir) throw new Error("Usage: shard-tests.mjs --out DIR [--discover|--check|--prove --results DIR] [--count N]");
  if (argv.includes("--check")) {
    const planned = await readPartition(outDir);
    const summary = assertPartition(planned.all, planned.shards);
    console.log(`shard-check files=${summary.files} sizes=${summary.sizes.join(",")}`);
    return;
  }
  if (argv.includes("--prove")) {
    const results = argValue(argv, "--results");
    if (!results) throw new Error("--prove requires --results DIR");
    const summary = await proveResults(outDir, results);
    console.log(`shard-proof files=${summary.files} sizes=${summary.sizes.join(",")} union=full duplicates=0`);
    return;
  }
  const count = argValue(argv, "--count") ?? process.env.CI_TEST_SHARDS;
  const stdin = await readStdin();
  const discover = argv.includes("--discover") || stdin.trim() === "ALL";
  const files = discover ? await discoverSupportedTests() : stdin.split("\n");
  const shards = partition(files, count);
  if (shards.every((shard) => shard.length === 0)) {
    throw new Error("refusing to shard an empty test list");
  }
  const manifest = await writePartition(outDir, shards);
  console.log(`shard-plan count=${manifest.count} files=${manifest.files} sizes=${manifest.sizes.join(",")}`);
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
