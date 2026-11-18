import { execFile } from "node:child_process";
import { createServer } from "node:http";
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

export async function text(dir, args) {
  const result = await invoke(dir, args);
  return { status: result.code ?? 0, stdout: result.stdout };
}

export async function json(dir, args) {
  const result = await invoke(dir, args);
  return { status: result.code ?? 0, stdout: result.stdout, json: result.stdout?.startsWith("{") ? JSON.parse(result.stdout) : null };
}

export function serve(status) {
  const server = createServer((request, response) => {
    response.writeHead(request.url === "/login" ? status : 404);
    response.end("ok");
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

export function tcp() {
  const server = createServer();
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}
