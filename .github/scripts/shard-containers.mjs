import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const IMAGE = /ghcr\.io\/hypertask-ai\/ci-|HTPR_PG_IMAGE/;
const POSTGRES = /ghcr\.io\/hypertask-ai\/ci-postgres|HTPR_PG_IMAGE/;
const STARTS_PROCESS = /spawn|execFile|execSync|exec\(/;

// A shard needs the registry login when one of its tests starts a container, and
// the PostgreSQL image when that container is the PG one. Reading the file beats
// matching its name: htpr-7038-model-reset and mcp-transports start containers
// without a `-postgres` in their name, and the source-text guard in
// tests/ci-images.test.cjs names every image without starting any.
export function fixturesNeeded(files, read = (file) => readFileSync(file, "utf8")) {
  let containers = false;
  let postgres = false;
  for (const file of files) {
    let text;
    try {
      text = read(file);
    } catch {
      continue;
    }
    if (!IMAGE.test(text) || !STARTS_PROCESS.test(text)) continue;
    containers = true;
    if (POSTGRES.test(text)) postgres = true;
  }
  return { containers, postgres };
}

export function outputLines({ containers, postgres }) {
  return [`containers=${containers ? 1 : ""}`, `need=${postgres ? 1 : ""}`];
}

function main() {
  const list = process.argv[2];
  if (!list) throw new Error("Usage: shard-containers.mjs <shard list file>");
  const files = readFileSync(list, "utf8").split("\n").filter((line) => line.length > 0);
  const needed = fixturesNeeded(files);
  console.error(`shard fixtures containers=${needed.containers ? 1 : 0} postgres=${needed.postgres ? 1 : 0}`);
  // stdout is appended straight to $GITHUB_OUTPUT, so it carries key=value only.
  process.stdout.write(`${outputLines(needed).join("\n")}\n`);
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) main();
