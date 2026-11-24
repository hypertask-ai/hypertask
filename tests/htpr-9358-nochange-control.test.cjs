const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } = require("node:fs");
const { spawnSync, execFileSync } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

const shipCheck = path.join(__dirname, "..", ".claude", "skills", "ship", "scripts", "ship-check");
const opener = "<p><strong>Resolved without a change:</strong> searched the logs at https://example.com/run/1 and found nothing.</p>";

let root;
let work;
let bin;
let seq = 0;

before(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "htpr-9358-"));
  const originPath = path.join(root, "origin.git");
  work = path.join(root, "work");
  bin = path.join(root, "bin");
  mkdirSync(bin, { recursive: true });
  execFileSync("git", ["init", "-q", "--bare", originPath]);
  execFileSync("git", ["clone", "-q", originPath, work], { stdio: "ignore" });
  execFileSync("git", ["-C", work, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"]);
  execFileSync("git", ["-C", work, "push", "-q", "origin", "HEAD:refs/heads/production"], { stdio: "ignore" });

  writeFileSync(path.join(bin, "gh"), "#!/usr/bin/env bash\nif [[ $1 == pr && $2 == list ]]; then echo \"[]\"; exit 0; fi\nif [[ $1 == api ]]; then echo 0; exit 0; fi\nexit 1\n");
  writeFileSync(path.join(bin, "hypertask"), "#!/usr/bin/env bash\n[[ $1 == comment && $2 == list ]] && cat \"$NC_COMMENTS\"\n");
  chmodSync(path.join(bin, "gh"), 0o755);
  chmodSync(path.join(bin, "hypertask"), 0o755);
});

after(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

function nochange(texts) {
  const id = ++seq;
  const commentsPath = path.join(root, `comments-${id}.json`);
  const evidence = path.join(root, `evidence-${id}`);
  mkdirSync(evidence, { recursive: true });
  writeFileSync(commentsPath, JSON.stringify({ success: true, comments: texts.map((text) => ({ text })) }));
  return spawnSync("bash", [shipCheck, "nochange", "HTPR-901"], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      SHIP_CHECKOUT: work,
      VCC_EVIDENCE_DIR: evidence,
      NC_COMMENTS: commentsPath,
    },
  });
}

function refused(texts) {
  const run = nochange(texts);
  assert.notEqual(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /Control line naming a search or a drive/);
}

test("a no change proof without a Control line fails", () => {
  refused([opener]);
});

test("a no change proof with a search that found the fault passes", () => {
  const run = nochange([opener + "<p>Control: the search found the fault on the previous build.</p>"]);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /nochange ok/);
});

test("a drive that found the fault on the build before the fix passes", () => {
  const run = nochange([opener + "<p><strong>Control:</strong> the drive found the fault on the build before the fix.</p>"]);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /nochange ok/);
});

test("a search that found errors on a numbered build passes", () => {
  const run = nochange([opener + "<p>Control: search log-scan found 12 errors on build 2580cd99.</p>"]);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /nochange ok/);
});

test("a Control line with no content fails", () => {
  refused([opener + "<p>Control:</p>"]);
});

test("a Control line that names no search or drive fails", () => {
  refused([opener + "<p>Control: x</p>"]);
});

test("a control search that found zero old errors fails", () => {
  refused([opener + "<p>Control: the search found zero old errors on the previous build.</p>"]);
});

test("a control search that found the README on the previous build fails", () => {
  refused([opener + "<p>Control: the search found the README on the previous build.</p>"]);
});

test("a descriptive search name that found the error on the previous build passes", () => {
  const run = nochange([opener + "<p>Control: the search of the production logs found the error on the previous build.</p>"]);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /nochange ok/);
});

test("a search that found the error in the README on the previous build passes", () => {
  const run = nochange([opener + "<p>Control: the search found the error in the README on the previous build.</p>"]);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /nochange ok/);
});

test("a control whose search did not find the fault fails", () => {
  refused([opener + "<p>Control: the search did not run; an observer found the fault on the previous build.</p>"]);
});

test("a bad build named in another clause fails", () => {
  refused([opener + "<p>Control: the search found the fault on the current good build; the previous build passed.</p>"]);
});

test("a control that says the fault was not found fails", () => {
  refused([opener + "<p>Control: the search has not found the fault on the previous build.</p>"]);
  refused([opener + "<p>Control: the search never found the fault on the previous build.</p>"]);
  refused([opener + "<p>Control: the search hasn't found the fault on the previous build.</p>"]);
  refused([opener + "<p>Control: the search did not find the fault on the previous build.</p>"]);
});

test("a control that found the fault, and not the new one, passes", () => {
  const run = nochange([opener + "<p>Control: the search found the fault on the previous build, not the new one.</p>"]);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /nochange ok/);
});

test("a control that found no fault fails", () => {
  refused([opener + "<p>Control: the search found no fault on the bad build.</p>"]);
});

test("a control with no known bad build fails", () => {
  refused([opener + "<p>Control: the search found the fault yesterday.</p>"]);
});

test("a Control line in another comment fails", () => {
  refused([opener, "<p>Control: the search found the fault on the previous build.</p>"]);
});
