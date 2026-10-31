const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const shipGates = path.join(repo, '.claude/skills/ship/scripts/ship-gates');
const shipCheck = path.join(repo, '.claude/skills/ship/scripts/ship-check');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-ledger-home-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  const calls = path.join(root, 'gate-calls');
  fs.mkdirSync(path.join(home, '.agents/skills/unlazy/scripts'), { recursive: true });
  fs.mkdirSync(path.join(home, '.agents/skills/ship/scripts'), { recursive: true });
  fs.mkdirSync(project);
  // The generated checks call the fake ship-check, so no gate reaches the network.
  fs.writeFileSync(path.join(home, '.agents/skills/ship/scripts/ship-check'),
    '#!/usr/bin/env bash\necho "marker ok"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(home, '.agents/skills/unlazy/scripts/gate-check.mjs'),
    'import { appendFileSync } from "node:fs";\n' +
    'appendFileSync(process.env.GATE_CALLS, JSON.stringify(process.argv.slice(2)) + "\\n");\n' +
    'console.log("UNMET: 9 (met: 0)");\nprocess.exit(1);\n');
  return { root, home, project, calls };
}

function gates(f, ticket, session, extraEnv = {}) {
  const result = spawnSync('bash', [shipGates, ticket], {
    cwd: f.project,
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

test('ship writes the ledger to the home ticket folder and leaves the project clean', () => {
  const f = fixture();
  try {
    const result = gates(f, 'HTPR-6819', 'sessionA-full');
    const ledger = path.join(f.home, '.unlazy/ledgers/HTPR-6819/GATES.md');
    assert.equal(result.stdout.trim(), ledger);
    const text = fs.readFileSync(ledger, 'utf8');
    assert.equal(text.match(/^- \[ \] HTPR-6819\./gm).length, 9);
    assert.equal(fs.readFileSync(path.join(f.home, '.unlazy/ledgers/HTPR-6819/session'), 'utf8'), 'sessionA-full\n');
    // The whole point: the project holds no session state at all, not even locks.
    assert.equal(fs.existsSync(path.join(f.project, '.unlazy')), false);
    // Gate checks run against the ticket folder, so a later re-run cannot leave locks behind either.
    const call = JSON.parse(fs.readFileSync(f.calls, 'utf8').trim().split('\n')[0]);
    assert.equal(call[0], '--approve');
    assert.equal(call[1], ledger);
    assert.equal(call[call.indexOf('--root') + 1], path.dirname(ledger));
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('a later session continues the same ticket ledger instead of needing a new one', () => {
  const f = fixture();
  try {
    gates(f, 'HTPR-6819', 'sessionA-full');
    const ledger = path.join(f.home, '.unlazy/ledgers/HTPR-6819/GATES.md');
    const before = fs.readFileSync(ledger, 'utf8');
    const result = gates(f, 'HTPR-6819', 'sessionB-full');
    assert.match(result.stderr, /HTPR-6819 ledger moved from session sessionA-full to sessionB-full/);
    assert.equal(fs.readFileSync(ledger, 'utf8'), before);
    assert.equal(fs.readFileSync(path.join(f.home, '.unlazy/ledgers/HTPR-6819/session'), 'utf8'), 'sessionB-full\n');
    // A second ticket gets its own folder rather than joining another ticket's ledger.
    gates(f, 'YPER4-123', 'sessionB-full');
    const other = path.join(f.home, '.unlazy/ledgers/YPER4-123/GATES.md');
    assert.equal(fs.readFileSync(other, 'utf8').match(/^- \[ \] YPER4-123\./gm).length, 8);
    assert.equal(fs.existsSync(path.join(f.project, '.unlazy')), false);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('the deeper proof gate is read from the home ticket folder, never from the project', () => {
  const f = fixture();
  try {
    const folder = path.join(f.home, '.unlazy/ledgers/HTPR-6819/gates');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'extra.md'),
      '- [ ] HTPR-6819.deeper-path: the ledger lives in the home folder\n  CHECK: true\n  EXPECT: true\n');
    const found = deeper(f, 'HTPR-6819', f.home);
    assert.equal(found.status, 0, `${found.stdout}${found.stderr}`);
    assert.match(found.stdout, /deeper ok/);

    // A gate left behind in the project is not read any more: the reader moved, it was not copied.
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
