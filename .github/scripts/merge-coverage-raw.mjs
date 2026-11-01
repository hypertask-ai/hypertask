import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// c8 reads its temp directory with one flat readdir, so a merged directory may
// not contain subdirectories, and two lanes can both name a dump
// `coverage-<pid>-<timestamp>-<n>.json`. The lane name goes in front of the file
// name so every lane's coverage survives (HYCI-53).
export async function mergeCoverageRaw(outDir, laneDirs) {
  await mkdir(outDir, { recursive: true });
  let files = 0;
  let lanes = 0;
  for (const [index, dir] of laneDirs.entries()) {
    let entries;
    try {
      entries = await readdir(dir);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      throw new Error(`missing coverage directory ${dir}`);
    }
    const dumps = entries.filter((name) => name.endsWith(".json")).sort();
    if (dumps.length === 0) continue;
    lanes += 1;
    for (const dump of dumps) {
      await copyFile(path.join(dir, dump), path.join(outDir, `lane-${index}--${dump}`));
      files += 1;
    }
  }
  return { files, lanes };
}

async function main() {
  const [outDir, ...laneDirs] = process.argv.slice(2);
  if (!outDir || laneDirs.length === 0) {
    throw new Error("Usage: merge-coverage-raw.mjs <out-dir> <lane-raw-dir ...>");
  }
  const merged = await mergeCoverageRaw(outDir, laneDirs);
  console.log(`merged ${merged.files} files from ${merged.lanes} lanes`);
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
