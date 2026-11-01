const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const shipGates = path.join(repo, '.claude/skills/ship/scripts/ship-gates');
const shipCheck = path.join(repo, '.claude/skills/ship/scripts/ship-check');
const pinnedUnlazy = path.join(process.env.HOME || os.homedir(), '.agents/skills/unlazy/scripts');
const needsUnlazy = fs.existsSync(path.join(pinnedUnlazy, 'lib/gates.mjs'))
  ? {}
  : { skip: `ship-gates imports ${pinnedUnlazy}/lib/gates.mjs; the ship-scripts-tests-siblings job installs that checkout` };

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-ledger-home-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  const calls = path.join(root, 'gate-calls');
  fs.mkdirSync(path.join(home, '.agents/skills/unlazy/scripts'), { recursive: true });
  fs.mkdirSync(path.join(home, '.agents/skills/ship/scripts'), { recursive: true });
  fs.mkdirSync(project);
  fs.symlinkSync(path.join(pinnedUnlazy, 'lib'), path.join(home, '.agents/skills/unlazy/scripts/lib'), 'dir');
  fs.writeFileSync(path.join(home, '.agents/skills/ship/scripts/ship-check'),
    '#!/usr/bin/env bash\necho "marker ok"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(home, '.agents/skills/unlazy/scripts/gate-check.mjs'),
    'import { appendFileSync } from "node:fs";\n' +
    'appendFileSync(process.env.GATE_CALLS, JSON.stringify(process.argv.slice(2)) + "\\n");\n' +
    'console.log("UNMET: 9 (met: 0)");\nprocess.exit(1);\n');
  return { root, home, project, calls };
}

function gates(f, ticket, session, extraEnv = {}, cwd = f.project) {
  const result = spawnSync('bash', [shipGates, ticket], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: f.home, GATE_CALLS: f.calls, CODEX_SESSION_ID: session, ...extraEnv },
  });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function deeper(f, ticket, extraEnv = {}) {
  const bin = path.join(f.root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const activity = 'Deeper: field: session ledgers | raw source: ship-gates | method: fixture | ' +
    `outside proof: CI run | breaks if: a ledger returns to the project | proof gate: ${ticket}.deeper-path`;
  fs.writeFileSync(path.join(bin, 'ht'),
    `#!/usr/bin/env bash\ncat <<'JSON'\n${JSON.stringify({
      activities: [{ type: 'thought', createdAt: '2026-11-01T00:00:00Z', text: activity }],
    })}\nJSON\n`, { mode: 0o755 });
  return spawnSync('bash', [shipCheck, 'deeper', ticket], {
    cwd: f.project,
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: f.home, ...extraEnv },
  });
}

test('a ship run writes its ledger to the home ticket folder and leaves the project clean', needsUnlazy, () => {
  const f = fixture();
  try {
    const result = gates(f, 'HTPR-6819', 'sessionA-full');
    const ledger = path.join(f.home, '.unlazy/ledgers/HTPR-6819/GATES.md');
    assert.equal(result.stdout.trim(), ledger);
    assert.equal(fs.readFileSync(ledger, 'utf8').match(/^- \[ \] HTPR-6819\./gm).length, 9);
    assert.equal(fs.readFileSync(path.join(f.home, '.unlazy/ledgers/HTPR-6819/session'), 'utf8'), 'sessionA-full\n');
    assert.equal(fs.existsSync(path.join(f.project, '.unlazy')), false, 'the project is not clean');
    const call = JSON.parse(fs.readFileSync(f.calls, 'utf8').trim().split('\n')[0]);
    assert.deepEqual(call, ['--approve', ledger, '--root', path.dirname(ledger)]);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('a later session continues the same ticket ledger and earns its gates again', needsUnlazy, () => {
  const f = fixture();
  try {
    gates(f, 'HTPR-6819', 'sessionA-full');
    const ledger = path.join(f.home, '.unlazy/ledgers/HTPR-6819/GATES.md');
    const lines = fs.readFileSync(ledger, 'utf8').split('\n');
    for (const name of ['merged', 'cleaned']) {
      const at = lines.findIndex((line) => line.startsWith(`- [ ] HTPR-6819.${name}:`));
      assert.ok(at > 0, `no ${name} gate in the ledger`);
      lines[at] = lines[at].replace('- [ ]', '- [x]');
    }
    fs.writeFileSync(ledger, lines.join('\n'));

    const handover = gates(f, 'HTPR-6819', 'sessionB-full');
    assert.match(handover.stderr, /HTPR-6819 ledger moved from session sessionA-full to sessionB-full; 9 generated gates written again/);
    const text = fs.readFileSync(ledger, 'utf8');
    assert.equal(text.match(/^- \[ \] HTPR-6819\./gm).length, 9, 'a handover kept a previous session result');
    assert.equal(fs.readFileSync(path.join(f.home, '.unlazy/ledgers/HTPR-6819/session'), 'utf8'), 'sessionB-full\n');
    assert.equal(fs.existsSync(path.join(f.project, '.unlazy')), false);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('a handover from another worktree or repository re-points the ledger at this session', needsUnlazy, () => {
  const f = fixture();
  const other = path.join(f.root, 'other');
  const cli = path.join(f.root, 'cli');
  for (const dir of [other, cli]) fs.mkdirSync(dir);
  const cwds = (text) => text.match(/^ {2}CWD: (.*)$/gm).map((line) => line.slice(7));
  try {
    gates(f, 'HTPR-6819', 'sessionA-full', {
      SHIP_REPO: 'hypertask-ai/cli', SHIP_BASE: 'main', SHIP_CHECKOUT: cli,
    });
    const ledger = path.join(f.home, '.unlazy/ledgers/HTPR-6819/GATES.md');
    assert.match(fs.readFileSync(ledger, 'utf8'), /^  CHECK: SHIP_REPO=hypertask-ai\/cli /m);

    const moved = gates(f, 'HTPR-6819', 'sessionB-full', {}, other);
    assert.match(moved.stderr, /9 generated gates written again/);
    const text = fs.readFileSync(ledger, 'utf8');
    assert.deepEqual([...new Set(cwds(text))], [other], 'a gate still points at the previous worktree');
    assert.doesNotMatch(text, /SHIP_REPO=/, 'a gate still points at the previous repository');
    assert.equal(fs.existsSync(path.join(other, '.unlazy')), false, 'the new worktree is not clean');
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('the deeper proof gate is read from the home ticket folder, and an older project folder still counts', needsUnlazy, () => {
  const f = fixture();
  const gate = (note) => `- [ ] HTPR-6819.deeper-path: ${note}\n  CHECK: true\n  EXPECT: true\n`;
  try {
    const home = path.join(f.home, '.unlazy/ledgers/HTPR-6819/gates');
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'extra.md'), gate('the ledger lives at home'));
    const found = deeper(f, 'HTPR-6819');
    assert.equal(found.status, 0, `${found.stdout}${found.stderr}`);
    assert.match(found.stdout, /deeper ok/);

    fs.rmSync(home, { recursive: true, force: true });
    const legacy = path.join(f.project, '.unlazy/s-abcdef12/gates');
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'extra.md'), gate('the old session scope'));
    const still = deeper(f, 'HTPR-6819', { CLAUDE_CODE_SESSION_ID: 'abcdef12-full' });
    assert.equal(still.status, 0, 'a gate left in the project stopped counting');
    assert.match(still.stdout, /deeper ok/);

    fs.rmSync(path.join(f.project, '.unlazy'), { recursive: true, force: true });
    const none = deeper(f, 'HTPR-6819', { CLAUDE_CODE_SESSION_ID: 'abcdef12-full' });
    assert.notEqual(none.status, 0);
    assert.match(none.stdout, /a manual note does not count/);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
