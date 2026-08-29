import { readdir } from "node:fs/promises";
import path from "node:path";

export const supportedTestSuffixes = [".test.cjs", ".test.ts"];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(absolute)));
    else if (entry.isFile()) files.push(absolute);
  }

  return files;
}

export function classifyTestFiles(files) {
  const candidates = files.filter((file) => /\.(?:test|spec)\.[^/]+$/.test(file));
  const supported = candidates.filter((file) =>
    supportedTestSuffixes.some((suffix) => file.endsWith(suffix)),
  );

  return {
    candidates,
    supported,
    unsupported: candidates.filter((file) => !supported.includes(file)),
  };
}

export async function discoverTestFiles({ root, testsRoot }) {
  const files = (await walk(testsRoot)).map((absolute) =>
    path.relative(root, absolute).split(path.sep).join("/"),
  );
  return classifyTestFiles(files);
}
