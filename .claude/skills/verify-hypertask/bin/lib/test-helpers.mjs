import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const cli = fileURLToPath(new URL("../ht-verify", import.meta.url));
const exec = promisify(execFile);

export function home() {
  return mkdtempSync(join(tmpdir(), "ht-verify-"));
}

async function invoke(dir, args) {
  return exec(process.execPath, [cli, ...args], {
    env: { ...process.env, HT_VERIFY_HOME: dir, HT_VERIFY_RUN: "" },
    timeout: 60_000,
  }).catch((error) => ({ stdout: error.stdout, stderr: error.stderr, code: error.code }));
}

export async function json(dir, args) {
  const result = await invoke(dir, args);
  return { status: result.code ?? 0, stdout: result.stdout, json: result.stdout?.startsWith("{") ? JSON.parse(result.stdout) : null };
}
