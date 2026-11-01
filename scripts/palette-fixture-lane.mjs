import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { classifySuite, partitionSafeFiles } from "./test-lanes.mjs";

const fixture = "tests/compose-task-palette.test.cjs";
const root = process.cwd();
const testsRoot = path.join(root, "tests");

const entries = (await readdir(testsRoot)).filter((name) => name.endsWith(".test.cjs")).sort();
const readers = [];
for (const name of entries) {
  const file = `tests/${name}`;
  if (file === fixture) continue;
  const source = await readFile(path.join(testsRoot, name), "utf8");
  if (source.includes("compose-task-palette.test.cjs")) readers.push(file);
}

const { safe } = await classifySuite({ root, files: readers });
console.log(safe.length > 1 ? partitionSafeFiles(safe, 1, () => 1)[0].join(" ") : "");
