ensureFlagIndex();

function ensureFlagIndex() {
  if (typeof process === "undefined" || !process.versions?.node || process.env.NODE_ENV === "production") return;
  const getter = (process as NodeJS.Process & { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
  if (typeof getter !== "function") return;
  const fs = getter("fs") as { existsSync(target: string): boolean };
  const path = getter("path") as {
    resolve(target: string): string;
    join(...parts: string[]): string;
    dirname(target: string): string;
  };
  const childProcess = getter("child_process") as {
    spawnSync(command: string, args: string[], options: { cwd: string; encoding: "utf8" }): { status: number | null; stderr: string };
  };
  const source = directoryWithGenerator(process.cwd(), fs, path);
  const repo = process.env.HYPERTASK_FLAG_INDEX_ROOT ? path.resolve(process.env.HYPERTASK_FLAG_INDEX_ROOT) : source;
  const definitions = path.join(repo, "src/lib/flags/definitions");
  const output = path.join(definitions, "index.generated.ts");
  const script = path.join(source, "scripts/generate-flag-index.mjs");
  if (!fs.existsSync(script) || !fs.existsSync(definitions) || fs.existsSync(output)) return;
  const result = childProcess.spawnSync(process.execPath, [script, repo], { cwd: source, encoding: "utf8" });
  if (result.status !== 0 || !fs.existsSync(output)) {
    throw new Error((result.stderr || "Could not build the flag list").trim());
  }
}

function directoryWithGenerator(
  start: string,
  fs: { existsSync(target: string): boolean },
  path: { resolve(target: string): string; join(...parts: string[]): string; dirname(target: string): string },
) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, "scripts/generate-flag-index.mjs"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}
