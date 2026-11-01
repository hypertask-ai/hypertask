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

function gates(f, ticket, session, { cwd = f.project, ...extraEnv } = {}) {
  const result = spawnSync('bash', [shipGates, ticket], {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: f.home,
      GATE_CALLS: f.calls,
      CODEX_SESSION_ID: session,
      ...extraEnv,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function deeper(f, ticket, stateRoot) {
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
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: f.home,
      SHIP_STATE_ROOT: stateRoot,
    },
  });
}

test('ship writes the ledger to the home ticket folder and leaves the project clean', needsUnlazy, () => {
  const f = fixture();
  try {
    const result = gates(f, 'HTPR-6819', 'sessionA-full');
    const ledger = path.join(f.home, '.unlazy/ledgers/HTPR-6819/GATES.md');
    assert.equal(result.stdout.trim(), ledger);
    const text = fs.readFileSync(ledger, 'utf8');
    assert.equal(text.match(/^- \[ \] HTPR-6819\./gm).length, 9);
    assert.equal(fs.readFileSync(path.join(f.home, '.unlazy/ledgers/HTPR-6819/session'), 'utf8'), 'sessionA-full\n');
    assert.equal(fs.existsSync(path.join(f.project, '.unlazy')), false);
    const call = JSON.parse(fs.readFileSync(f.calls, 'utf8').trim().split('\n')[0]);
    assert.equal(call[0], '--approve');
    assert.equal(call[1], ledger);
    assert.equal(call[call.indexOf('--root') + 1], path.dirname(ledger));
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('a later session continues the same ticket ledger instead of needing a new one', needsUnlazy, () => {
  const f = fixture();
  try {
    gates(f, 'HTPR-6819', 'sessionA-full');
    const ledger = path.join(f.home, '.unlazy/ledgers/HTPR-6819/GATES.md');
    const before = fs.readFileSync(ledger, 'utf8');
    const result = gates(f, 'HTPR-6819', 'sessionB-full');
    assert.match(result.stderr, /HTPR-6819 ledger moved from session sessionA-full to sessionB-full/);
    assert.equal(fs.readFileSync(ledger, 'utf8'), before);
    assert.equal(fs.readFileSync(path.join(f.home, '.unlazy/ledgers/HTPR-6819/session'), 'utf8'), 'sessionB-full\n');
    gates(f, 'YPER4-123', 'sessionB-full');
    const other = path.join(f.home, '.unlazy/ledgers/YPER4-123/GATES.md');
    assert.equal(fs.readFileSync(other, 'utf8').match(/^- \[ \] YPER4-123\./gm).length, 8);
    assert.equal(fs.existsSync(path.join(f.project, '.unlazy')), false);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('a session in another worktree moves the ticket gates only when it asks to', needsUnlazy, () => {
  const f = fixture();
  try {
    gates(f, 'HTPR-6819', 'sessionA-full');
    const ledger = path.join(f.home, '.unlazy/ledgers/HTPR-6819/GATES.md');
    const worktree = path.join(f.root, 'project-worktree');
    fs.mkdirSync(worktree);
    const refused = spawnSync('bash', [shipGates, 'HTPR-6819'], {
      cwd: worktree,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: f.home, GATE_CALLS: f.calls, CODEX_SESSION_ID: 'sessionB-full' },
    });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /re-run with SHIP_LEDGER_MOVE=1/);
    assert.equal(fs.readFileSync(ledger, 'utf8').includes(`  CWD: ${f.project}`), true);

    const result = gates(f, 'HTPR-6819', 'sessionB-full', { cwd: worktree, SHIP_LEDGER_MOVE: '1' });
    assert.match(result.stderr, /HTPR-6819 ledger gates moved from /);
    const text = fs.readFileSync(ledger, 'utf8');
    assert.equal(text.match(/^ {2}CWD: /gm).length, 9);
    assert.equal(text.split('\n').filter((line) => line === `  CWD: ${worktree}`).length, 9);
    assert.equal(fs.existsSync(path.join(worktree, '.unlazy')), false);
    const call = JSON.parse(fs.readFileSync(f.calls, 'utf8').trim().split('\n').pop());
    assert.equal(call[call.indexOf('--root') + 1], path.dirname(ledger));
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('moving a pinned ledger re-points it at this session checkout', needsUnlazy, () => {
  const f = fixture();
  const cli = { SHIP_REPO: 'hypertask-ai/cli', SHIP_BASE: 'main', SHIP_CHECKOUT: '/home/u/old checkout' };
  try {
    gates(f, 'HTPR-6819', 'sessionA-full', cli);
    const ledger = path.join(f.home, '.unlazy/ledgers/HTPR-6819/GATES.md');
    assert.equal(fs.readFileSync(ledger, 'utf8').includes("SHIP_CHECKOUT='/home/u/old checkout' "), true);
    const worktree = path.join(f.root, 'cli-worktree');
    fs.mkdirSync(worktree);
    const result = gates(f, 'HTPR-6819', 'sessionB-full',
      { cwd: worktree, SHIP_LEDGER_MOVE: '1', ...cli, SHIP_CHECKOUT: '/home/u/new checkout' });
    assert.match(result.stderr, /ledger gates moved from /);
    const text = fs.readFileSync(ledger, 'utf8');
    assert.equal(text.includes("SHIP_CHECKOUT='/home/u/old checkout'"), false);
    assert.equal(text.split('\n').filter((line) => line.startsWith("  CHECK: SHIP_REPO=hypertask-ai/cli SHIP_BASE=main SHIP_CHECKOUT='/home/u/new checkout' '")).length, 9);
    assert.equal(text.split('\n').filter((line) => line === `  CWD: ${worktree}`).length, 9);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('a ledger left inside the project is adopted into the home ticket folder', needsUnlazy, () => {
  const f = fixture();
  try {
    gates(f, 'HTPR-6819', 'sessionA-full');
    const home = path.join(f.home, '.unlazy/ledgers/HTPR-6819');
    const legacy = path.join(f.project, '.unlazy/s-sessionA');
    fs.mkdirSync(path.join(legacy, 'gates'), { recursive: true });
    fs.writeFileSync(path.join(legacy, 'GATES.md'), fs.readFileSync(path.join(home, 'GATES.md'), 'utf8'));
    fs.writeFileSync(path.join(legacy, 'gates/extra.md'),
      '- [x] HTPR-6819.deeper-path: the old session scope\n  CHECK: true\n  EXPECT: true\n' +
      '  CWD: /old/checkout\n  EVIDENCE: automatic-evidence=v1; exit=0\n\n' +
      '- [x] HTPR-9999.deeper-other: another ticket\n  CHECK: true\n  EXPECT: true\n');
    fs.writeFileSync(path.join(legacy, 'session'), 'sessionA-full\n');
    const stale = path.join(f.project, '.unlazy/s-sessionZ');
    fs.mkdirSync(stale);
    fs.writeFileSync(path.join(stale, 'GATES.md'), fs.readFileSync(path.join(home, 'GATES.md'), 'utf8'));
    fs.writeFileSync(path.join(stale, 'session'), 'sessionZ-full\n');
    fs.rmSync(home, { recursive: true, force: true });

    const result = gates(f, 'HTPR-6819', 'sessionB-full', { SHIP_LEDGER_MOVE: '1' });
    assert.match(result.stderr, /HTPR-6819 ledger adopted from /);
    assert.equal(fs.readFileSync(path.join(home, 'GATES.md'), 'utf8').match(/^- \[ \] HTPR-6819\./gm).length, 9);
    const extra = fs.readFileSync(path.join(home, 'gates/extra.md'), 'utf8');
    assert.match(extra, /^- \[ \] HTPR-6819\.deeper-path: /m);
    assert.equal(extra.includes(`  CWD: ${f.project}`), true);
    assert.equal(extra.includes('EVIDENCE: pending'), true);
    assert.equal(extra.includes('/old/checkout'), false);
    assert.equal(fs.existsSync(path.join(legacy, 'GATES.md')), false);
    const left = fs.readFileSync(path.join(legacy, 'gates/extra.md'), 'utf8');
    assert.equal(left.includes('HTPR-6819'), false);
    assert.match(left, /^- \[x\] HTPR-9999\.deeper-other: /m);
    assert.equal(fs.existsSync(stale), false);
    assert.equal(fs.existsSync(path.join(legacy, 'session')), true);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('a ledger that changes hands clears the previous session cleanup result', needsUnlazy, () => {
  const f = fixture();
  try {
    gates(f, 'HTPR-6819', 'sessionA-full');
    const ledger = path.join(f.home, '.unlazy/ledgers/HTPR-6819/GATES.md');
    const lines = fs.readFileSync(ledger, 'utf8').split('\n');
    for (const name of ['merged', 'cleaned']) {
      const at = lines.findIndex((line) => line.startsWith(`- [ ] HTPR-6819.${name}:`));
      assert.ok(at > 0, `no ${name} gate in the ledger`);
      lines[at] = lines[at].replace('- [ ]', '- [x]');
      lines[at + 4] = '  EVIDENCE: automatic-evidence=v1; exit=0; EXPECT=matched';
    }
    fs.writeFileSync(ledger, lines.join('\n'));

    gates(f, 'HTPR-6819', 'sessionB-full');
    const text = fs.readFileSync(ledger, 'utf8').split('\n');
    const at = text.findIndex((line) => line.startsWith('- [ ] HTPR-6819.cleaned:'));
    assert.ok(at > 0, 'the cleaned gate kept its previous session result');
    assert.equal(text[at + 4], '  EVIDENCE: pending');
    assert.equal(text.some((line) => line.startsWith('- [x] HTPR-6819.merged:')), true);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('an unprefixed ledger counts as the app repo, so a CLI session refuses it', needsUnlazy, () => {
  const f = fixture();
  try {
    gates(f, 'HTPR-6819', 'sessionA-full');
    const worktree = path.join(f.root, 'cli-worktree');
    fs.mkdirSync(worktree);
    const refused = spawnSync('bash', [shipGates, 'HTPR-6819'], {
      cwd: worktree,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: f.home,
        GATE_CALLS: f.calls,
        CODEX_SESSION_ID: 'sessionB-full',
        SHIP_LEDGER_MOVE: '1',
        SHIP_REPO: 'hypertask-ai/cli',
        SHIP_BASE: 'main',
        SHIP_CHECKOUT: '/home/u/cli',
      },
    });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /ledger belongs to hypertask-ai\/hypertask, not hypertask-ai\/cli/);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('a handover in the same directory still refuses another repository', needsUnlazy, () => {
  const f = fixture();
  const cli = { SHIP_REPO: 'hypertask-ai/cli', SHIP_BASE: 'main', SHIP_CHECKOUT: '/home/u/cli' };
  try {
    gates(f, 'HTPR-6819', 'sessionA-full', cli);
    const refused = spawnSync('bash', [shipGates, 'HTPR-6819'], {
      cwd: f.project,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: f.home, GATE_CALLS: f.calls, CODEX_SESSION_ID: 'sessionB-full' },
    });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /ledger belongs to hypertask-ai\/cli, not hypertask-ai\/hypertask/);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('the deeper proof gate is read from the home ticket folder, never from the project', needsUnlazy, () => {
  const f = fixture();
  try {
    const folder = path.join(f.home, '.unlazy/ledgers/HTPR-6819/gates');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'extra.md'),
      '- [ ] HTPR-6819.deeper-path: the ledger lives in the home folder\n  CHECK: true\n  EXPECT: true\n');
    const found = deeper(f, 'HTPR-6819', f.home);
    assert.equal(found.status, 0, `${found.stdout}${found.stderr}`);
    assert.match(found.stdout, /deeper ok/);

    fs.rmSync(folder, { recursive: true, force: true });
    const stale = path.join(f.project, '.unlazy/s-abcdef12/gates');
    fs.mkdirSync(stale, { recursive: true });
    fs.writeFileSync(path.join(stale, 'extra.md'),
      '- [ ] HTPR-6819.deeper-path: the old session scope\n  CHECK: true\n  EXPECT: true\n');
    const missed = deeper(f, 'HTPR-6819', f.home);
    assert.notEqual(missed.status, 0);
    assert.match(missed.stdout, /ledgers\/HTPR-6819\/gates\/\*\.md; a manual note does not count/);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
