const assert = require("node:assert/strict");
const { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const test = require("node:test");

const root = join(__dirname, "..");
const installer = join(root, ".github/scripts/install-action-archive-cache.sh");
const manifest = join(root, ".github/actions/action-archive-cache-manifest.txt");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "action-archive-cache-test-"));
  const source = join(directory, "fixture-action-0123456");
  await mkdir(source);
  await writeFile(join(source, "action.yml"), "name: fixture\nruns:\n  using: node20\n  main: index.js\n");
  const archive = join(directory, "fixture.tar.gz");
  run("tar", ["-czf", archive, "-C", directory, "fixture-action-0123456"]);

  const bin = join(directory, "bin");
  await mkdir(bin);
  const fakeCurl = join(bin, "curl");
  await writeFile(
    fakeCurl,
    `#!/usr/bin/env bash
set -euo pipefail
output=""
while (($#)); do
  if [[ "$1" == "--output" ]]; then output=$2; shift 2; else shift; fi
done
sleep "\${FAKE_CURL_DELAY:-0}"
printf 'download\\n' >> "$FAKE_CURL_COUNTER"
cp "$FAKE_CURL_ARCHIVE" "$output"
`,
  );
  await chmod(fakeCurl, 0o755);

  const sha = "0123456789abcdef0123456789abcdef01234567";
  const fixtureManifest = join(directory, "manifest.txt");
  await writeFile(fixtureManifest, `example/action ${sha} v1\n`);
  return {
    directory,
    archive,
    bin,
    counter: join(directory, "downloads.log"),
    fixtureManifest,
    sha,
  };
}

function invoke(config, cache, extraEnv = {}) {
  return run(installer, ["--manifest", config.fixtureManifest, "--cache-dir", cache], {
    env: {
      ...process.env,
      PATH: `${config.bin}:${process.env.PATH}`,
      FAKE_CURL_ARCHIVE: config.archive,
      FAKE_CURL_COUNTER: config.counter,
      ...extraEnv,
    },
  });
}

test("the updater installs a validated immutable archive and reuses it", async (t) => {
  const config = await fixture();
  t.after(() => rm(config.directory, { recursive: true, force: true }));
  const cache = join(config.directory, "cache");
  invoke(config, cache);

  const archive = join(cache, "example_action", `${config.sha}.tar.gz`);
  assert.equal((await stat(archive)).mode & 0o777, 0o444);
  run("tar", ["-tzf", archive]);

  invoke(config, cache);
  const downloads = (await readFile(config.counter, "utf8")).trim().split("\n");
  assert.equal(downloads.length, 1, "an already-valid immutable archive must not be downloaded again");
});

test("concurrent updaters serialize population of the shared cache", async (t) => {
  const config = await fixture();
  t.after(() => rm(config.directory, { recursive: true, force: true }));
  const cache = join(config.directory, "concurrent-cache");
  const args = ["--manifest", config.fixtureManifest, "--cache-dir", cache];
  const env = {
    ...process.env,
    PATH: `${config.bin}:${process.env.PATH}`,
    FAKE_CURL_ARCHIVE: config.archive,
    FAKE_CURL_COUNTER: config.counter,
    FAKE_CURL_DELAY: "0.2",
  };
  const launch = () => new Promise((resolve, reject) => {
    const child = spawn(installer, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(stderr)));
  });

  await Promise.all([launch(), launch()]);
  const downloads = (await readFile(config.counter, "utf8")).trim().split("\n");
  assert.equal(downloads.length, 1);
});

test("an invalid cached archive is quarantined and replaced", async (t) => {
  const config = await fixture();
  t.after(() => rm(config.directory, { recursive: true, force: true }));
  const cache = join(config.directory, "repair-cache");
  const actionDirectory = join(cache, "example_action");
  await mkdir(actionDirectory, { recursive: true });
  const archive = join(actionDirectory, `${config.sha}.tar.gz`);
  await writeFile(archive, "not a gzip archive");

  invoke(config, cache);
  run("tar", ["-tzf", archive]);
  const entries = await readdir(actionDirectory);
  assert.ok(entries.some((entry) => entry.startsWith(`${config.sha}.tar.gz.invalid.`)));
});

test("all remote workflow actions are pinned and represented in the cache manifest", async () => {
  const workflowDirectory = join(root, ".github/workflows");
  const workflows = (await readdir(workflowDirectory))
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));
  const manifestRepositories = new Set(
    (await readFile(manifest, "utf8"))
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split(/\s+/)[0]),
  );

  for (const workflow of workflows) {
    const source = await readFile(join(workflowDirectory, workflow), "utf8");
    for (const match of source.matchAll(/uses:\s*([^\s#]+)(?:\s*#.*)?$/gm)) {
      const use = match[1];
      if (use.startsWith("./") || use.startsWith("docker://")) continue;
      if (!use.includes("/")) continue;
      const separator = use.lastIndexOf("@");
      assert.notEqual(separator, -1, `${workflow}: ${use} has no ref`);
      const repository = use.slice(0, separator).split("/").slice(0, 2).join("/");
      const ref = use.slice(separator + 1);
      assert.match(ref, /^[0-9a-f]{40}$/, `${workflow}: ${use} is not commit-pinned`);
      assert.ok(manifestRepositories.has(repository), `${workflow}: ${repository} is missing from the cache manifest`);
    }
  }
});
