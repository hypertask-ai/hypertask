ensureFlagIndex();

type BuiltinGetter = (id: string) => unknown;

function builtinGetter(): BuiltinGetter | null {
  const getter = (process as NodeJS.Process & { getBuiltinModule?: BuiltinGetter }).getBuiltinModule;
  return typeof getter === "function" ? getter : null;
}

function repoFrom(start: string, fs: typeof import("node:fs"), path: typeof import("node:path")) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, "scripts/generate-flag-index.mjs"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

export function ensureFlagIndex(root?: string) {
  if (typeof process === "undefined" || !process.versions?.node || process.env.NODE_ENV === "production") return;
  const getter = builtinGetter();
  if (!getter) return;
  const fs = getter("fs") as typeof import("node:fs");
  const path = getter("path") as typeof import("node:path");
  const url = getter("url") as typeof import("node:url");
  const childProcess = getter("child_process") as typeof import("node:child_process");
  const here = typeof import.meta.url === "string" && import.meta.url.startsWith("file:")
    ? path.dirname(url.fileURLToPath(import.meta.url))
    : process.cwd();
  const source = repoFrom(here, fs, path);
  const repo = root ?? source;
  const definitions = path.join(repo, "src/lib/flags/definitions");
  const output = path.join(definitions, "index.generated.ts");
  const script = path.join(source, "scripts/generate-flag-index.mjs");
  if (!fs.existsSync(script) || !fs.existsSync(definitions) || fs.existsSync(output)) return;
  const result = childProcess.spawnSync(process.execPath, [script, repo], { cwd: source, encoding: "utf8" });
  if (result.status !== 0 || !fs.existsSync(output)) {
    throw new Error((result.stderr || "Could not build the flag list").trim());
  }
}
