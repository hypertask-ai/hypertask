import {
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function relocateEslintCache(cachePath, workspace = process.cwd()) {
  if (!existsSync(cachePath)) return { status: "missing", relocated: 0 };

  let cache;
  try {
    cache = JSON.parse(readFileSync(cachePath, "utf8"));
  } catch {
    unlinkSync(cachePath);
    return { status: "invalid", relocated: 0 };
  }

  const entries = Array.isArray(cache) ? cache[0] : null;
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    unlinkSync(cachePath);
    return { status: "invalid", relocated: 0 };
  }

  const configPath = Object.keys(entries).find(
    (filePath) => path.isAbsolute(filePath) && path.basename(filePath) === "eslint.config.mjs",
  );
  if (!configPath) return { status: "unrecognized", relocated: 0 };

  const previousWorkspace = path.dirname(configPath);
  const currentWorkspace = path.resolve(workspace);
  if (path.resolve(previousWorkspace) === currentWorkspace) {
    return { status: "unchanged", relocated: 0 };
  }

  const previousPrefix = `${previousWorkspace}${path.sep}`;
  const relocatedEntries = {};
  let relocated = 0;

  for (const [filePath, value] of Object.entries(entries)) {
    if (filePath.startsWith(previousPrefix)) {
      const relativePath = path.relative(previousWorkspace, filePath);
      relocatedEntries[path.join(currentWorkspace, relativePath)] = value;
      relocated += 1;
    } else {
      relocatedEntries[filePath] = value;
    }
  }

  cache[0] = relocatedEntries;
  writeFileSync(cachePath, JSON.stringify(cache));
  return { status: "relocated", relocated };
}

function main() {
  const cachePath = process.argv[2] || ".cache/eslint/.eslintcache";
  const workspace = process.argv[3] || process.env.GITHUB_WORKSPACE || process.cwd();
  const result = relocateEslintCache(cachePath, workspace);
  console.log(`ESLint cache ${result.status}; relocated ${result.relocated} paths.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
