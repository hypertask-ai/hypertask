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

test('the owning session moves its ledger to another checkout and earns its gates again', needsUnlazy, () => {
  const f = fixture();
  const main = path.join(f.root, 'main');
  fs.mkdirSync(main);
  const ledger = path.join(f.home, '.unlazy/ledgers/HTPR-6819/GATES.md');
  const cwds = (text) => text.match(/^ {2}CWD: (.*)$/gm).map((line) => line.slice(7));
  try {
    gates(f, 'HTPR-6819', 'sessionA-full');
    fs.writeFileSync(ledger, fs.readFileSync(ledger, 'utf8').replace('- [ ] HTPR-6819.merged:', '- [x] HTPR-6819.merged:'));

    const refused = spawnSync('bash', [shipGates, 'HTPR-6819'], {
      cwd: main, encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: f.home, GATE_CALLS: f.calls, CODEX_SESSION_ID: 'sessionA-full' },
    });
    assert.notEqual(refused.status, 0, 'a second checkout was accepted without the move flag');
    assert.match(refused.stderr, /SHIP_LEDGER_MOVE=1 to move them here and earn them again/);

    const moved = gates(f, 'HTPR-6819', 'sessionA-full', { SHIP_LEDGER_MOVE: '1' }, main);
    assert.match(moved.stderr, new RegExp(`ledger checkout moved to ${main}; 9 generated gates written again`));
    const text = fs.readFileSync(ledger, 'utf8');
    assert.deepEqual([...new Set(cwds(text))], [main], 'a gate still points at the removed worktree');
    assert.equal(text.match(/^- \[ \] HTPR-6819\./gm).length, 9, 'the move kept a previous result');
    assert.equal(fs.existsSync(path.join(main, '.unlazy')), false, 'the new checkout is not clean');
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('a ticket gate left in the project is named on the first home write, then carried over on an adopt', needsUnlazy, () => {
  const f = fixture();
  const legacy = path.join(f.project, '.unlazy/s-abcdef12/GATES.md');
  const ledger = path.join(f.home, '.unlazy/ledgers/HTPR-6819/GATES.md');
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, '# Gates: /ship\n\n' +
    '- [ ] HTPR-6819.qa-note: the outcome this session still owes\n  CHECK: echo carried\n  EXPECT: carried\n' +
    `  CWD: ${f.project}\n  EVIDENCE: pending\n\n` +
    '- [ ] HTPR-7000.other: another ticket\n  CHECK: echo other\n  EXPECT: other\n');
  const carried = path.join(f.home, '.unlazy/ledgers/HTPR-6819/gates/adopted.md');
  try {
    const refused = spawnSync('bash', [shipGates, 'HTPR-6819'], {
      cwd: f.project, encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: f.home, GATE_CALLS: f.calls, CODEX_SESSION_ID: 'sessionA-full' },
    });
    assert.notEqual(refused.status, 0, 'a stranded ticket gate was dropped silently');
    assert.match(refused.stderr, new RegExp(`HTPR-6819\\.qa-note in ${legacy} are not carried beside ${ledger}`));
    assert.equal(fs.existsSync(ledger), false, 'the ledger was written despite the refusal');

    const adopted = gates(f, 'HTPR-6819', 'sessionA-full', { SHIP_LEDGER_ADOPT: '1' });
    assert.match(adopted.stderr, new RegExp(`carried HTPR-6819\\.qa-note over from ${legacy} into ${carried}`));
    const text = fs.readFileSync(ledger, 'utf8');
    assert.equal(text.match(/^- \[ \] HTPR-6819\./gm).length, 9, 'a taken-over check entered the auto-approved ledger');
    assert.doesNotMatch(text, /qa-note/, 'the ledger itself was approved with a command nobody reviewed');
    assert.match(fs.readFileSync(carried, 'utf8'), /^- \[ \] HTPR-6819\.qa-note: the outcome this session still owes$/m);
    assert.doesNotMatch(fs.readFileSync(carried, 'utf8'), /HTPR-7000/, "another ticket's gate came along");
    assert.match(fs.readFileSync(path.join(f.home, '.unlazy/ledgers/HTPR-6819/adopted'), 'utf8'), /^HTPR-6819\.qa-note [0-9a-f]{64}$/m);
    assert.equal(fs.existsSync(legacy), true, 'the project ledger was taken away');

    gates(f, 'HTPR-6819', 'sessionA-full');
    assert.equal(fs.readFileSync(ledger, 'utf8').match(/^- \[ \] HTPR-6819\./gm).length, 9, 'a later run lost the standard gates');
    assert.match(fs.readFileSync(carried, 'utf8'), /^- \[ \] HTPR-6819\.qa-note:/m, 'a later run lost the carried gate');
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('a board drain keeps one ledger per session outside the project', needsUnlazy, () => {
  const f = fixture();
  const drainBoard = path.join(repo, '.claude/skills/drain-board/scripts/drain-board');
  const bin = path.join(f.root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'hypertask'),
    '#!/usr/bin/env bash\nprintf \'{"success":true,"tasks":[{"ticketNumber":"HTPR-1","title":"one","section":"Backlog"}]}\\n\'\n',
    { mode: 0o755 });
  const drain = (session) => spawnSync('bash', [drainBoard, 'gates', '11514'], {
    cwd: f.project, encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: f.home, GATE_CALLS: f.calls, CLAUDE_CODE_SESSION_ID: session },
  });
  try {
    for (const session of ['sessionA-full', 'sessionB-full']) {
      const result = drain(session);
      assert.equal(result.status, 0, result.stderr);
    }
    const a = path.join(f.home, '.unlazy/ledgers/drain-11514/s-sessionA/gates/drain-11514.md');
    const b = path.join(f.home, '.unlazy/ledgers/drain-11514/s-sessionB/gates/drain-11514.md');
    assert.notEqual(a, b, 'two drains share one file');
    assert.equal(fs.readFileSync(a, 'utf8').match(/^- \[ \] drain-11514\./gm).length, 1);
    assert.equal(fs.readFileSync(b, 'utf8').match(/^- \[ \] drain-11514\./gm).length, 1);
    assert.equal(drain('sessionA-full').status, 0);
    assert.equal(fs.readFileSync(a, 'utf8').match(/^- \[ \] drain-11514\./gm).length, 1, 'a rerun duplicated the gates');
    assert.match(fs.readFileSync(f.calls, 'utf8'), /--approve\",\"\S*drain-11514\/s-sessionA\/gates\/drain-11514\.md/, 'the drain never ran the checker');
    assert.equal(fs.existsSync(path.join(f.project, '.unlazy')), false, 'the project is not clean');
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('an extra proof gate left in the project is named, then carried beside the ticket ledger', needsUnlazy, () => {
  const f = fixture();
  const legacy = path.join(f.project, '.unlazy/s-abcdef12/gates/extra.md');
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, '# extra gates\n\n' +
    '- [ ] HTPR-6819.deeper-path: the proof this session still owes\n  CHECK: echo proven\n  EXPECT: proven\n\n' +
    '- [ ] HTPR-7000.deeper-path: another ticket\n  CHECK: echo other\n  EXPECT: other\n');
  const ledger = path.join(f.home, '.unlazy/ledgers/HTPR-6819/GATES.md');
  const carried = path.join(f.home, '.unlazy/ledgers/HTPR-6819/gates/adopted.md');
  try {
    const refused = spawnSync('bash', [shipGates, 'HTPR-6819'], {
      cwd: f.project, encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: f.home, GATE_CALLS: f.calls, CODEX_SESSION_ID: 'sessionA-full' },
    });
    assert.notEqual(refused.status, 0, 'a stranded extra gate was dropped silently');
    assert.match(refused.stderr, new RegExp(`HTPR-6819\\.deeper-path in ${legacy}`));
    assert.equal(fs.existsSync(ledger), false, 'the ledger was written despite the refusal');

    gates(f, 'HTPR-6819', 'sessionA-full', { SHIP_LEDGER_ADOPT: '1' });
    const text = fs.readFileSync(ledger, 'utf8');
    assert.equal(text.match(/^- \[ \] HTPR-6819\./gm).length, 9, 'an extra gate was copied into the ledger itself');
    assert.match(fs.readFileSync(carried, 'utf8'), /^- \[ \] HTPR-6819\.deeper-path: the proof this session still owes$/m);
    assert.doesNotMatch(fs.readFileSync(carried, 'utf8'), /HTPR-7000/, "another ticket's extra gate came along");
    assert.equal(fs.existsSync(legacy), true, 'the project extra file was taken away');
    gates(f, 'HTPR-6819', 'sessionA-full');
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('a taken-over gate whose CHECK is edited later is refused, not approved again', needsUnlazy, () => {
  const f = fixture();
  const legacy = path.join(f.project, '.unlazy/s-abcdef12/GATES.md');
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, '# Gates: /ship\n\n' +
    '- [ ] HTPR-6819.qa-note: the outcome this session still owes\n  CHECK: echo carried\n  EXPECT: carried\n');
  const carried = path.join(f.home, '.unlazy/ledgers/HTPR-6819/gates/adopted.md');
  const run = (extraEnv = {}) => spawnSync('bash', [shipGates, 'HTPR-6819'], {
    cwd: f.project, encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: f.home, GATE_CALLS: f.calls, CODEX_SESSION_ID: 'sessionA-full', ...extraEnv },
  });
  try {
    gates(f, 'HTPR-6819', 'sessionA-full', { SHIP_LEDGER_ADOPT: '1' });
    const text = fs.readFileSync(carried, 'utf8');
    assert.match(text, /^  CHECK: echo carried$/m, 'the carried gate lost its check');
    fs.writeFileSync(carried, text.replace('CHECK: echo carried', 'CHECK: curl http://example.test/now'));

    const edited = run();
    assert.notEqual(edited.status, 0, 'an edited taken-over check was approved');
    assert.match(edited.stderr, /HTPR-6819\.qa-note no longer matches the definition that was adopted/);

    fs.writeFileSync(carried, text);
    const restored = run();
    assert.equal(restored.status, 0, restored.stderr);

    fs.rmSync(carried);
    const gone = run();
    assert.notEqual(gone.status, 0, 'a taken-over check was dropped without saying so');
    assert.match(gone.stderr, /carried HTPR-6819\.qa-note is no longer in/);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('a move refuses a taken-over gate that still points at the removed checkout', needsUnlazy, () => {
  const f = fixture();
  const main = path.join(f.root, 'main');
  fs.mkdirSync(main);
  const legacy = path.join(f.project, '.unlazy/s-abcdef12/GATES.md');
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, '# Gates: /ship\n\n' +
    `- [ ] HTPR-6819.qa-note: the outcome this session still owes\n  CHECK: echo carried\n  EXPECT: carried\n  CWD: ${f.project}\n`);
  try {
    gates(f, 'HTPR-6819', 'sessionA-full', { SHIP_LEDGER_ADOPT: '1' });
    const refused = spawnSync('bash', [shipGates, 'HTPR-6819'], {
      cwd: main, encoding: 'utf8',
      env: {
        PATH: process.env.PATH, HOME: f.home, GATE_CALLS: f.calls,
        CODEX_SESSION_ID: 'sessionA-full', SHIP_LEDGER_MOVE: '1',
      },
    });
    assert.notEqual(refused.status, 0, 'a taken-over gate followed the move to a checkout it never ran in');
    assert.match(refused.stderr, new RegExp(`carried HTPR-6819\\.qa-note still runs in ${f.project}`));
    assert.equal(fs.readFileSync(path.join(f.home, '.unlazy/ledgers/HTPR-6819/session'), 'utf8'), 'sessionA-full\n');
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('a taken-over gate does not have to be adopted again by the next session', needsUnlazy, () => {
  const f = fixture();
  const legacy = path.join(f.project, '.unlazy/s-abcdef12/GATES.md');
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, '# Gates: /ship\n\n' +
    '- [ ] HTPR-6819.qa-note: the outcome this session still owes\n  CHECK: echo carried\n  EXPECT: carried\n');
  const ledger = path.join(f.home, '.unlazy/ledgers/HTPR-6819/GATES.md');
  const carried = path.join(f.home, '.unlazy/ledgers/HTPR-6819/gates/adopted.md');
  try {
    gates(f, 'HTPR-6819', 'sessionA-full', { SHIP_LEDGER_ADOPT: '1' });
    const handover = gates(f, 'HTPR-6819', 'sessionB-full');
    assert.match(handover.stderr, /9 generated gates written again/);
    assert.equal(fs.readFileSync(ledger, 'utf8').match(/^- \[ \] HTPR-6819\./gm).length, 9);
    assert.match(fs.readFileSync(carried, 'utf8'), /^- \[ \] HTPR-6819\.qa-note:/m, 'the taken-over gate was lost on handover');
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('a standard gate that lost its CHECK is written again as a runnable check', needsUnlazy, () => {
  const f = fixture();
  const ledger = path.join(f.home, '.unlazy/ledgers/HTPR-6819/GATES.md');
  try {
    gates(f, 'HTPR-6819', 'sessionA-full');
    let inside = false;
    const lines = fs.readFileSync(ledger, 'utf8').split('\n').filter((line) => {
      if (line.startsWith('- [ ] HTPR-6819.merged:')) inside = true;
      else if (/^[^ ]/.test(line)) inside = false;
      return !(inside && /^  (CHECK|EXPECT): /.test(line));
    });
    fs.writeFileSync(ledger, lines.join('\n'));
    assert.equal(fs.readFileSync(ledger, 'utf8').match(/^  CHECK: /gm).length, 8, 'the fixture did not drop the gate check');

    const again = gates(f, 'HTPR-6819', 'sessionA-full');
    assert.match(again.stderr, /HTPR-6819\.merged written again; a standard gate is a runnable check/);
    const text = fs.readFileSync(ledger, 'utf8');
    assert.equal(text.match(/^- \[ \] HTPR-6819\./gm).length, 9, 'the manual replacement gate was kept');
    assert.match(text, /^- \[ \] HTPR-6819\.merged: The PR is merged into production\n  CHECK: /m);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('a handover drops the ABANDON of a gate it writes again and keeps unrelated ones', needsUnlazy, () => {
  const f = fixture();
  const ledger = path.join(f.home, '.unlazy/ledgers/HTPR-6819/GATES.md');
  try {
    gates(f, 'HTPR-6819', 'sessionA-full');
    fs.writeFileSync(ledger, fs.readFileSync(ledger, 'utf8') +
      '\n- [ ] HTPR-6819.manual: a note this session keeps\n  EVIDENCE: pending\n' +
      '\n- [ ] HTPR-7000.manual: another ticket in the same ledger\n  EVIDENCE: pending\n' +
      '\nABANDON: HTPR-6819.merged the merge job crashed\n\nABANDON: HTPR-7000.manual that is another ticket\n');

    const handover = gates(f, 'HTPR-6819', 'sessionB-full');
    assert.match(handover.stderr, /9 generated gates written again/);
    const text = fs.readFileSync(ledger, 'utf8');
    assert.doesNotMatch(text, /ABANDON: HTPR-6819\.merged/, 'the new session inherited an abandonment');
    assert.match(text, /^ABANDON: HTPR-7000\.manual that is another ticket$/m);
    assert.match(text, /^- \[ \] HTPR-6819\.manual: a note this session keeps$/m);
    assert.equal(text.match(/^- \[ \] HTPR-6819\./gm).length, 10);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('a move refuses a hand-written proof gate still on the old checkout', needsUnlazy, () => {
  const f = fixture();
  const main = path.join(f.root, 'main');
  fs.mkdirSync(main);
  const extra = path.join(f.home, '.unlazy/ledgers/HTPR-6819/gates/extra.md');
  try {
    gates(f, 'HTPR-6819', 'sessionA-full');
    fs.mkdirSync(path.dirname(extra), { recursive: true });
    fs.writeFileSync(extra, `- [ ] HTPR-6819.extra-path: the proof this session still owes\n  CHECK: echo proven\n  EXPECT: proven\n  CWD: ${f.project}\n`);
    const moved = spawnSync('bash', [shipGates, 'HTPR-6819'], { cwd: main, encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: f.home, GATE_CALLS: f.calls, CODEX_SESSION_ID: 'sessionA-full', SHIP_LEDGER_MOVE: '1' } });
    assert.notEqual(moved.status, 0, 'a stale hand-written gate followed the move silently');
    assert.match(moved.stderr, new RegExp(`HTPR-6819\\.extra-path in ${extra} still runs in ${f.project}`));
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('a legacy ledger that cannot be parsed is refused, not silently dropped', needsUnlazy, () => {
  const f = fixture();
  const legacy = path.join(f.project, '.unlazy/s-abcdef12/GATES.md');
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, '# Gates: /ship\n\n' +
    '- [ ] HTPR-6819.qa-note: the outcome this session still owes\n  CHECK: echo carried\n  EXPECT: carried\n\n' +
    '- [ ] HTPR-6819.qa-note: a duplicate id\n  CHECK: echo again\n  EXPECT: again\n');
  try {
    const refused = spawnSync('bash', [shipGates, 'HTPR-6819'], { cwd: f.project, encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: f.home, GATE_CALLS: f.calls, CODEX_SESSION_ID: 'sessionA-full' } });
    assert.notEqual(refused.status, 0, 'a malformed legacy ledger was dropped silently');
    assert.match(refused.stderr, new RegExp(`${legacy} cannot be parsed`));
    assert.match(refused.stderr, /duplicate gate id HTPR-6819\.qa-note/);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('a re-adoption refuses when the project copy changed, not recording a digest it did not copy', needsUnlazy, () => {
  const f = fixture();
  const legacy = path.join(f.project, '.unlazy/s-abcdef12/GATES.md');
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  const gate = (check) => '# Gates: /ship\n\n' +
    `- [ ] HTPR-6819.qa-note: the outcome this session still owes\n  CHECK: ${check}\n  EXPECT: carried\n`;
  fs.writeFileSync(legacy, gate('echo carried'));
  const carried = path.join(f.home, '.unlazy/ledgers/HTPR-6819/gates/adopted.md');
  try {
    gates(f, 'HTPR-6819', 'sessionA-full', { SHIP_LEDGER_ADOPT: '1' });
    assert.match(fs.readFileSync(carried, 'utf8'), /CHECK: echo carried/);
    fs.writeFileSync(legacy, gate('echo changed'));
    fs.rmSync(path.join(f.home, '.unlazy/ledgers/HTPR-6819/GATES.md'));
    const again = spawnSync('bash', [shipGates, 'HTPR-6819'], { cwd: f.project, encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: f.home, GATE_CALLS: f.calls, CODEX_SESSION_ID: 'sessionA-full', SHIP_LEDGER_ADOPT: '1' } });
    assert.notEqual(again.status, 0, 'a changed project gate was re-adopted without copying its new definition');
    assert.match(again.stderr, new RegExp(`HTPR-6819\\.qa-note in ${carried} no longer match`));
    assert.match(again.stderr, /SHIP_LEDGER_ADOPT=1/);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('a legacy gate defined twice in two project folders is refused, not silently replaced', needsUnlazy, () => {
  const f = fixture();
  const first = path.join(f.project, '.unlazy/s-aaaa1111/GATES.md');
  const second = path.join(f.project, '.unlazy/s-bbbb2222/GATES.md');
  const gate = (check) => '# Gates: /ship\n\n' +
    `- [ ] HTPR-6819.qa-note: the outcome this session still owes\n  CHECK: ${check}\n  EXPECT: carried\n`;
  const carried = path.join(f.home, '.unlazy/ledgers/HTPR-6819/gates/adopted.md');
  const run = () => spawnSync('bash', [shipGates, 'HTPR-6819'], { cwd: f.project, encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: f.home, GATE_CALLS: f.calls, CODEX_SESSION_ID: 'sessionA-full', SHIP_LEDGER_ADOPT: '1' } });
  fs.mkdirSync(path.dirname(first), { recursive: true });
  fs.mkdirSync(path.dirname(second), { recursive: true });
  try {
    fs.writeFileSync(first, gate('echo carried'));
    fs.writeFileSync(second, gate('echo carried'));
    const identical = run();
    assert.equal(identical.status, 0, identical.stderr);
    assert.equal(fs.readFileSync(carried, 'utf8').match(/^- \[ \] HTPR-6819\.qa-note:/gm).length, 1,
      'an identical repeat of one gate was carried twice or refused');

    fs.writeFileSync(second, gate('echo other'));
    fs.rmSync(carried);
    fs.rmSync(path.join(f.home, '.unlazy/ledgers/HTPR-6819/GATES.md'));
    const refused = run();
    assert.notEqual(refused.status, 0, 'the alphabetically first definition replaced the other one');
    assert.match(refused.stderr, new RegExp(`${first} and ${second} both define HTPR-6819\\.qa-note with different checks`));
    assert.equal(fs.existsSync(carried), false, 'a conflicting definition was carried anyway');
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
