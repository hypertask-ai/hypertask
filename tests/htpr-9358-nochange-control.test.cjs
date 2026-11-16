const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } = require('node:fs');
const { spawnSync, execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const shipCheck = path.join(__dirname, '..', '.claude', 'skills', 'ship', 'scripts', 'ship-check');
const opener = '<p><strong>Resolved without a change:</strong> searched the logs at https://example.com/run/1 and found nothing.</p>';
const control = '<p>Control: the same search found 12 errors on the previous build.</p>';

let root;
let work;
let bin;
let evidence;
let commentsPath;

before(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'htpr-9358-'));
  const originPath = path.join(root, 'origin.git');
  work = path.join(root, 'work');
  bin = path.join(root, 'bin');
  evidence = path.join(root, 'evidence');
  commentsPath = path.join(root, 'comments.json');
  mkdirSync(bin, { recursive: true });
  mkdirSync(evidence, { recursive: true });
  execFileSync('git', ['init', '-q', '--bare', originPath]);
  execFileSync('git', ['clone', '-q', originPath, work], { stdio: 'ignore' });
  execFileSync('git', ['-C', work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  execFileSync('git', ['-C', work, 'push', '-q', 'origin', 'HEAD:refs/heads/production'], { stdio: 'ignore' });

  writeFileSync(path.join(bin, 'gh'), '#!/usr/bin/env bash\nif [[ $1 == pr && $2 == list ]]; then echo "[]"; exit 0; fi\nif [[ $1 == api ]]; then echo 0; exit 0; fi\nexit 1\n');
  writeFileSync(path.join(bin, 'hypertask'), '#!/usr/bin/env bash\n[[ $1 == comment && $2 == list ]] && cat "$NC_COMMENTS"\n');
  chmodSync(path.join(bin, 'gh'), 0o755);
  chmodSync(path.join(bin, 'hypertask'), 0o755);
});

after(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

function nochange(texts) {
  writeFileSync(commentsPath, JSON.stringify({ success: true, comments: texts.map((text) => ({ text })) }));
  return spawnSync('bash', [shipCheck, 'nochange', 'HTPR-901'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      SHIP_CHECKOUT: work,
      VCC_EVIDENCE_DIR: evidence,
      NC_COMMENTS: commentsPath,
    },
  });
}

test('a no change proof without a Control line fails', () => {
  const run = nochange([opener]);
  assert.notEqual(run.status, 0);
  assert.match(run.stdout, /Control:/);
});

test('a no change proof with a Control line passes', () => {
  const run = nochange([opener + control]);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /nochange ok/);
});

test('a Control line with no content fails', () => {
  const run = nochange([opener, '<p>Control:</p>']);
  assert.notEqual(run.status, 0);
  assert.match(run.stdout, /Control:/);
});

test('a Control line in another comment fails', () => {
  const run = nochange([opener, control]);
  assert.notEqual(run.status, 0);
  assert.match(run.stdout, /Control:/);
});
