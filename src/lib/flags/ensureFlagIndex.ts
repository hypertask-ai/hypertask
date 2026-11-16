function repoFrom(start: string) {
  const fs = process.getBuiltinModule("fs");
  const path = process.getBuiltinModule("path");
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, "scripts/generate-flag-index.mjs"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

export function ensureFlagIndex(root?: string) {
  if (typeof process === "undefined" || !process.versions?.node || typeof process.getBuiltinModule !== "function") return;
  if (process.env.NODE_ENV === "production") return;
  const fs = process.getBuiltinModule("fs");
  const path = process.getBuiltinModule("path");
  const childProcess = process.getBuiltinModule("child_process");
  const source = repoFrom(process.cwd());
  const repo = root ?? source;
  const script = path.join(source, "scripts/generate-flag-index.mjs");
  const definitions = path.join(repo, "src/lib/flags/definitions");
  const output = path.join(definitions, "index.generated.ts");
  if (!fs.existsSync(script) || !fs.existsSync(definitions) || fs.existsSync(output)) return;
  const result = childProcess.spawnSync(process.execPath, [script, repo], { cwd: source, encoding: "utf8" });
  if (result.status !== 0 || !fs.existsSync(output)) {
    throw new Error((result.stderr || "Could not build the flag list").trim());
  }
}

ensureFlagIndex();
