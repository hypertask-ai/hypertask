#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function git(argumentsList) {
  return execFileSync("git", argumentsList, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function install() {
  const root = git(["rev-parse", "--show-toplevel"]);
  const hooksDirectory = resolve(root, git(["rev-parse", "--git-common-dir"]), "hooks");
  const target = join(hooksDirectory, "pre-push");
  const body = readFileSync(join(root, ".githooks", "pre-push"), "utf8");
  const marker = "hypertask quick check hook";

  if (existsSync(target) && readFileSync(target, "utf8") !== body && !readFileSync(target, "utf8").includes(marker)) {
    console.log(`install-git-hooks: ${target} already exists and is not this repository's hook, leaving it alone`);
    return;
  }

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body);
  chmodSync(target, 0o755);
  console.log(`install-git-hooks: pre-push quick check installed at ${target}`);

  let hooksPath = "";
  try {
    hooksPath = git(["config", "--get", "core.hooksPath"]);
  } catch {
    hooksPath = "";
  }
  if (hooksPath) {
    console.log(
      `install-git-hooks: core.hooksPath is ${hooksPath}; ${target} runs only if that path forwards to repository hooks`,
    );
  }
}

try {
  install();
} catch (error) {
  console.log(`install-git-hooks: skipped (${error.message.split("\n")[0]})`);
}
