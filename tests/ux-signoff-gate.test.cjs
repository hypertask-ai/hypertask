const assert = require('node:assert/strict');
const { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { tmpdir } = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');
const fixtureName = (filename) => filename.replaceAll('.test.', '.case.') + '.txt';
const { pathToFileURL } = require('node:url');
const { test: nodeTest } = require('node:test');
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7) ?? (process.argv.includes('--historical-only') ? 'real PR ' : null);
const test = (name, fn) => nodeTest(name, { skip: only != null && !name.includes(only) }, fn);

const root = path.resolve(__dirname, '..');
const gate = import(pathToFileURL(process.env.UX_SIGNOFF_GATE_PATH || path.join(root, '.github/scripts/ux-signoff-gate.mjs')));
const modified = { filename: 'src/components/x/Foo.tsx', status: 'modified' };
const added = { filename: 'src/components/notifications/ExamplePanel.tsx', status: 'added' };
const title = 'HTPR-7072 [FEATURE] Decision inbox';
const wireframe = (overrides = {}) => ({
  id: 1, text: '<p><a href="https://hypertask.app/wireframes/decision-inbox">Wireframe</a></p><p>New elements: ExamplePanel</p>',
  createdAt: '2026-10-10T12:00:00Z', creatorId: 6, agent: { id: 'agent' }, reactions: [], ...overrides,
});
const yes = (overrides = {}) => ({
  id: 2, text: '<p>yes go</p>', createdAt: '2026-10-10T12:01:00Z', creatorId: 6, agent: null, reactions: [], ...overrides,
});
const input = (overrides = {}) => ({ title, author: 'builder', files: [modified, added], comments: [], ...overrides });
async function decision(overrides) {
  const result = (await gate).evaluate(input(overrides));
  assert.ok(result.description.length <= 140);
  return result;
}

function historicalRemovalFixture(number) {
  const directory = path.join(__dirname, 'fixtures/ux-signoff', `pr-${number}`);
  const metadata = JSON.parse(readFileSync(path.join(directory, 'pr.json'), 'utf8'));
  const sources = Object.fromEntries(metadata.files.filter((file) => file.status !== 'added').map((file) =>
    [file.filename, readFileSync(path.join(directory, 'base', fixtureName(file.filename)), 'utf8')]));
  return { ...metadata, sources, productionModes: JSON.parse(sources['e2e/smoke/production-flag-modes.json']) };
}

for (const number of [1910, 1931]) {
  test(`real PR ${number}: complete historical flag-removal replay`, async () => {
    const fixture = historicalRemovalFixture(number);
    const result = await decision(fixture);
    assert.equal(result.state, 'success', JSON.stringify(result));
    if (number === 1910) {
      assert.match(result.description, /^Flag removal only:/);
      assert.deepEqual(result.details, []);
    } else {
      assert.doesNotMatch(result.description, /^Flag removal only:/);
      assert.deepEqual((await gate).flagRemovalOnly(fixture.files, fixture.productionModes, fixture.sources), []);
    }
    const directory = mkdtempSync(path.join(tmpdir(), 'ux-signoff-pr-'));
    try {
      const script = path.join(directory, '.github/scripts/ux-signoff-gate.mjs');
      mkdirSync(path.dirname(script), { recursive: true });
      writeFileSync(script, readFileSync(process.env.UX_SIGNOFF_GATE_PATH || path.join(root, '.github/scripts/ux-signoff-gate.mjs')));
      writeFileSync(path.join(path.dirname(script), 'github-rate-limit.mjs'), readFileSync(path.join(root, '.github/scripts/github-rate-limit.mjs')));
      for (const [filename, source] of Object.entries(fixture.sources)) {
        const target = path.join(directory, filename);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, source);
      }
      const isolated = await import(pathToFileURL(script));
      const output = [];
      assert.equal(await isolated.run(['--pr', String(number)], {
        env: number === 1910 ? {} : env,
        github: async (endpoint) => endpoint.includes('/files?') ? fixture.files : {
          number, title: fixture.title, user: { login: fixture.author }, changed_files: fixture.files.length,
        },
        fetchImpl: number === 1910 ? () => assert.fail('proven full PR must not need ticket approval') : commentsFetch,
        log: (line) => output.push(JSON.parse(line)),
      }), 0);
      assert.deepEqual(output, [result]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('historical fixtures reproduce every full base/head blob and complete PR patch', () => {
  for (const number of [1910, 1931]) {
    const fixture = historicalRemovalFixture(number);
    const directory = path.join(__dirname, 'fixtures/ux-signoff', `pr-${number}`);
    assert.match(fixture.baseRefOid, /^[a-f0-9]{40}$/);
    assert.match(fixture.headRefOid, /^[a-f0-9]{40}$/);
    for (const file of fixture.files) {
      const blobs = {};
      for (const side of ['base', 'head']) {
        const filename = path.join(directory, side, fixtureName(file.filename));
        const absent = side === 'base' ? file.status === 'added' : file.status === 'removed';
        assert.equal(existsSync(filename), !absent, `${number} ${side} ${file.filename}`);
        blobs[side] = absent ? '' : readFileSync(filename, 'utf8');
        assert.equal(absent ? null : createHash('sha256').update(blobs[side]).digest('hex'), file.blobs[side]);
      }
      const lines = blobs.base ? blobs.base.slice(0, -1).split('\n') : [];
      const output = [];
      let cursor = 0;
      let additions = 0;
      let deletions = 0;
      for (const hunk of file.patch.split(/(?=^@@ )/m)) {
        const [header, ...rows] = hunk.replace(/\n$/, '').split('\n');
        const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header);
        assert.ok(match, header);
        const start = Math.max(0, Number(match[1]) - 1);
        assert.ok(start >= cursor);
        output.push(...lines.slice(cursor, start));
        cursor = start;
        let oldCount = 0;
        let newCount = 0;
        for (const row of rows) {
          assert.match(row, /^[ +-]/);
          if (row[0] !== '+') { assert.equal(lines[cursor++], row.slice(1)); oldCount++; }
          if (row[0] !== '-') { output.push(row.slice(1)); newCount++; }
          if (row[0] === '+') additions++;
          if (row[0] === '-') deletions++;
        }
        assert.equal(oldCount, Number(match[2] ?? 1));
        assert.equal(newCount, Number(match[4] ?? 1));
      }
      output.push(...lines.slice(cursor));
      assert.equal(output.length ? output.join('\n') + '\n' : '', blobs.head, `${number} ${file.filename}`);
      assert.equal(additions, file.additions);
      assert.equal(deletions, file.deletions);
    }
  }
});

if (process.argv.includes('--git-fixtures')) {
  test('historical fixture Git provenance matches both complete changed-file lists and every blob', () => {
    let blobs = 0;
    for (const number of [1910, 1931]) {
      const fixture = historicalRemovalFixture(number);
      const changed = execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', fixture.baseRefOid, fixture.headRefOid], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).sort();
      assert.deepEqual(changed, fixture.files.map((file) => file.filename).sort());
      for (const file of fixture.files) {
        for (const side of ['base', 'head']) {
          const result = spawnSync('git', ['show', `${fixture[side + 'RefOid']}:${file.filename}`], { cwd: root });
          if (file.blobs[side] === null) assert.notEqual(result.status, 0);
          else {
            assert.equal(result.status, 0);
            assert.deepEqual(result.stdout, readFileSync(path.join(__dirname, 'fixtures/ux-signoff', `pr-${number}`, side, fixtureName(file.filename))));
            blobs++;
          }
        }
      }
    }
    console.log(`Git fixture provenance: ${blobs} exact blobs verified`);
  });
}

const patch = (filename, source, target, status) => {
  const oldLines = source.slice(0, -1).split('\n');
  const newLines = target ? target.slice(0, -1).split('\n') : [];
  return { filename, status, additions: newLines.length, deletions: oldLines.length,
    patch: [`@@ -1,${oldLines.length} +${newLines.length ? 1 : 0},${newLines.length} @@`,
      ...oldLines.map((line) => `-${line}`), ...newLines.map((line) => `+${line}`)].join('\n') };
};

function removalFixture({ mode = 'EVERYONE', before: original, after, call = 'useFlag(HTPR_1_PANEL_FLAG)', module = '@/hooks/useFlag' } = {}) {
  const key = 'htpr-1-panel';
  const filename = 'src/components/Panel.tsx';
  const definition = `src/lib/flags/definitions/${key}.ts`;
  const before = original ?? [
    `import { ${call.startsWith('await ') ? 'isFeatureEnabled' : 'useFlag'} } from "${module}";`,
    'import { HTPR_1_PANEL_FLAG } from "@/lib/flags/keys";',
    'export default async function Panel() {',
    `  const panelEnabled = ${call};`,
    '  return (',
    '    <main>',
    '      {panelEnabled && (',
    '        <button>Existing action</button>',
    '      )}',
    '    </main>',
    '  );',
    '}',
    '',
  ].join('\n');
  const retained = after ?? [
    'export default async function Panel() {',
    '  return (',
    '    <main>',
    '      <button>Existing action</button>',
    '    </main>',
    '  );',
    '}',
    '',
  ].join('\n');
  const definitionSource = `export const HTPR_1_PANEL_FLAG = "${key}";\nexport default { key: HTPR_1_PANEL_FLAG };\n`;

  return {
    files: [patch(definition, definitionSource, '', 'removed'), patch(filename, before, retained, 'modified')],
    sources: { [filename]: before, [definition]: definitionSource },
    productionModes: { modes: { [key]: mode } },
  };
}

const removedFlags = async (fixture) => (await gate).flagRemovalOnly(fixture.files, fixture.productionModes, fixture.sources);
const withNewComponent = (fixture) => ({ ...fixture, files: [...fixture.files, added] });

async function assertRemovalProven(fixture) {
  assert.deepEqual(await removedFlags(fixture), ['htpr-1-panel']);
  assert.match((await decision(fixture)).description, /^Flag removal only/);
}

async function assertRemovalUnproven(fixture) {
  assert.deepEqual(await removedFlags(fixture), []);
  assert.match((await decision(fixture)).description, /^No new component file/);
  const withComponent = withNewComponent(fixture);
  assert.equal((await decision(withComponent)).state, 'failure');
  assert.equal((await decision({ ...withComponent, comments: [wireframe(), yes()] })).state, 'success');
}

test('EVERYONE flag removal keeps the existing flag-on JSX and needs no wireframe', async () => {
  assert.deepEqual(await decision(removalFixture()), {
    state: 'success', description: 'Flag removal only: htpr-1-panel already on for everyone', details: [],
  });
  const server = removalFixture({ call: 'await isFeatureEnabled(HTPR_1_PANEL_FLAG, userId)', module: '@/lib/flags' });
  await assertRemovalProven(server);
});

for (const [name, beforeText, afterText, expected] of [
  ['unchanged interpolation', '`Open ${task.id}`', '`Open ${task.id}`', 'success'],
  ['unchanged flag-like template text', '`useFlag HTPR_1_PANEL_FLAG panelEnabled`', '`useFlag HTPR_1_PANEL_FLAG panelEnabled`', 'success'],
  ['nested unchanged template', '`Open ${`task-${task.id}`}`', '`Open ${`task-${task.id}`}`', 'success'],
  ['only the flag branch changes', '`${panelEnabled ? "Existing" : "Legacy"}`', '`${"Existing"}`', 'success'],
  ['new visible template text', '`Open ${task.id}`', '`New action ${task.id}`', 'failure'],
  ['new visible interpolation', '`${panelEnabled ? "Existing" : "Legacy"}`', '`${"New copy"}`', 'failure'],
  ['template text is not code', '`panelEnabled && Existing`', '`Existing`', 'failure'],
  ['unterminated template', '`Existing ${task.id}', '`Existing ${task.id}', 'failure'],
  ['unsupported interpolation division', '`Value ${total / count}`', '`Value ${total / count}`', 'failure'],
  ['unchanged regex still keeps sign-off next to a folded flag', '/[{}]/', '/[{}]/', 'failure'],
  ['regex text is not code', '/panelEnabled && Existing/', '/Existing/', 'failure'],
  ['unsupported nested regex class', '/[[a]--[b]]/v', '/[[a]--[b]]/v', 'failure'],
]) {
  test(`template and regex proof: ${name}`, async () => {
    const imports = 'import { useFlag } from "@/hooks/useFlag";\nimport { HTPR_1_PANEL_FLAG } from "@/lib/flags/keys";\n';
    const body = (text, enabled) => `  const label = ${text};\n  return <ExistingPanel label={label} enabled={${enabled}} />;\n}\n`;
    const before = imports + 'export function Panel() {\n  const panelEnabled = useFlag(HTPR_1_PANEL_FLAG);\n' + body(beforeText, 'panelEnabled && layoutEnabled');
    const after = 'export function Panel() {\n' + body(afterText, 'layoutEnabled');
    assert[expected === 'success' ? 'match' : 'doesNotMatch']((await decision({ ...removalFixture({ before, after }), title: 'HTPR-1 [REFACTOR] Remove flag' })).description, /^Flag removal only/);
  });
}

test('production source reader accepts normal route folders and spaces, not traversal or shell syntax', async () => {
  for (const [filename, expected] of [
    ['src/app/detail/[...slug]/Panel.tsx', 0],
    ['src/app/detail/[id]/Panel.tsx', 0],
    ['src/app/Task Detail/Panel.tsx', 0],
    ['src/app/../Panel.tsx', 1],
    ['src/app/$(touch marker)/Panel.tsx', 1],
  ]) {
    const fixture = removalFixture();
    const old = fixture.files[1].filename;
    fixture.files[1].filename = filename;
    fixture.sources[filename] = fixture.sources[old];
    delete fixture.sources[old];
    const directory = mkdtempSync(path.join(tmpdir(), 'ux-signoff-route-'));
    try {
      const script = path.join(directory, '.github/scripts/ux-signoff-gate.mjs');
      mkdirSync(path.dirname(script), { recursive: true });
      writeFileSync(script, readFileSync(path.join(root, '.github/scripts/ux-signoff-gate.mjs')));
      writeFileSync(path.join(path.dirname(script), 'github-rate-limit.mjs'), readFileSync(path.join(root, '.github/scripts/github-rate-limit.mjs')));
      const sources = { ...fixture.sources, 'e2e/smoke/production-flag-modes.json': JSON.stringify(fixture.productionModes) };
      for (const [relative, source] of Object.entries(sources)) {
        const target = path.join(directory, relative);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, source);
      }
      const isolated = await import(pathToFileURL(script));
      const lines = [];
      assert.equal(await isolated.run(['--pr', '1'], {
        env,
        github: async (endpoint) => endpoint.includes('/files?') ? fixture.files : {
          number: 1, title: 'HTPR-1 [REFACTOR] Remove flag', user: { login: 'builder' }, changed_files: fixture.files.length,
        },
        fetchImpl: commentsFetch,
        log: (line) => lines.push(JSON.parse(line)),
      }), 0, filename);
      assert[expected ? 'doesNotMatch' : 'match'](lines.at(-1).description, /^Flag removal only/, filename);
      assert.equal(existsSync(path.join(directory, 'marker')), false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

for (const number of [1910, 1931]) {
  for (const addition of ['<aside>New visible element</aside>', 'New user-facing copy']) {
    test(`real fixture mixed change still refused: PR ${number} plus ${addition}`, async () => {
      const fixture = historicalRemovalFixture(number);
      const filename = number === 1910 ? 'src/app/detail/[...slug]/useTaskDetailModalActions.tsx' : 'src/app/search/SearchChipsInput.tsx';
      const after = readFileSync(path.join(__dirname, 'fixtures/ux-signoff', `pr-${number}`, 'head', fixtureName(filename)), 'utf8') + `export const NewContent = () => <div>${addition}</div>;\n`;
      fixture.files = fixture.files.map((file) => file.filename === filename ? patch(filename, fixture.sources[filename], after, 'modified') : file);
      assert.doesNotMatch((await decision(fixture)).description, /^Flag removal only/);
    });
  }
}

test('full historical proof still refuses changed server text, unproven call arguments and scope metadata', async () => {
  for (const [filename, change] of [
    ['src/lib/search/serverOperators.ts', (text) => text + 'export const newLabel = "New visible copy";\n'],
    ['.github/scripts/agent-scope/agent-scope-exceptions.json', (text) => text.replace('validateMcpAuth supplies', 'Unreviewed scope change supplies')],
    ['src/lib/search/rankedWhere.ts', (text) => text.replace('scanAll = false,', 'scanAll = true,')],
  ]) {
    const fixture = historicalRemovalFixture(1931);
    const after = change(readFileSync(path.join(__dirname, 'fixtures/ux-signoff/pr-1931/head', fixtureName(filename)), 'utf8'));
    fixture.files = fixture.files.map((file) => file.filename === filename ? patch(filename, fixture.sources[filename], after, 'modified') : file);
    assert.doesNotMatch((await decision(fixture)).description, /^Flag removal only/, filename);
  }
  const fixture = historicalRemovalFixture(1931);
  const filename = 'src/lib/mcp/operations/tasks/search/operation.ts';
  const before = fixture.sources[filename].replace('personProjectIds, commenterEnabled, logicEnabled)', 'personProjectIds, false, logicEnabled)');
  const after = readFileSync(path.join(__dirname, 'fixtures/ux-signoff/pr-1931/head', fixtureName(filename)), 'utf8');
  fixture.sources[filename] = before;
  fixture.files = fixture.files.map((file) => file.filename === filename ? patch(filename, before, after, 'modified') : file);
  assert.doesNotMatch((await decision(fixture)).description, /^Flag removal only/);
});

test('a parameter with the same name as a flag is not proof without a flag-on caller', async () => {
  const fixture = removalFixture({ call: 'await isFeatureEnabled(HTPR_1_PANEL_FLAG, userId)', module: '@/lib/flags' });
  const filename = 'src/lib/unrelated.ts';
  const before = 'export async function unrelated(value, panelEnabled = false) {\n  return present(value, panelEnabled);\n}\n';
  const after = 'export async function unrelated(value) {\n  return present(value, true);\n}\n';
  fixture.sources[filename] = before;
  fixture.files.push(patch(filename, before, after, 'modified'));
  assert.doesNotMatch((await decision(fixture)).description, /^Flag removal only/);
});

test('exported parameter specialization refuses indirect callers', async () => {
  const before = 'import { isFeatureEnabled } from "@/lib/flags";\n' +
    'import { HTPR_1_PANEL_FLAG } from "@/lib/flags/keys";\n' +
    'import { renderLabel } from "@/lib/label";\n' +
    'export async function Panel() {\n' +
    '  const panelEnabled = await isFeatureEnabled(HTPR_1_PANEL_FLAG, userId);\n' +
    '  const run = renderLabel;\n' +
    '  const label = await renderLabel("value", panelEnabled);\n' +
    '  const other = await run("value");\n' +
    '  return <ExistingPanel label={label} other={other} enabled={panelEnabled} />;\n}\n';
  const after = before.replace(/^import .*flags[^\n]*\n/gm, '').replace(/^  const panelEnabled = .*\n/m, '')
    .replace('"value", panelEnabled', '"value"').replace('enabled={panelEnabled}', 'enabled={true}');
  const fixture = removalFixture({ before, after });
  const filename = 'src/lib/label.ts';
  const original = 'export async function renderLabel(value, panelEnabled = false) {\n  return present(value, panelEnabled);\n}\n';
  const retained = 'export async function renderLabel(value) {\n  return present(value, true);\n}\n';
  fixture.sources[filename] = original;
  fixture.files.push(patch(filename, original, retained, 'modified'));
  const control = structuredClone(fixture);
  control.sources['src/components/Panel.tsx'] = before.replace('  const run = renderLabel;\n', '').replace('await run("value")', 'label');
  control.files[1] = patch('src/components/Panel.tsx', control.sources['src/components/Panel.tsx'],
    after.replace('  const run = renderLabel;\n', '').replace('await run("value")', 'label'), 'modified');
  assert.doesNotMatch((await decision(control)).description, /^Flag removal only/);
  assert.deepEqual((await gate).flagRemovalOnly(control.files, control.productionModes, control.sources), []);
  for (const [reference, invocation, extraImport = ''] of [
    ['const run = renderLabel;', 'run("value")'],
    ['const run = { renderLabel };', 'run.renderLabel("value")'],
    ['', 'invoke(renderLabel, "value")'],
    ['', 'renderLabel.call(null, "value")'],
    ['', 'run("value")', 'import { renderLabel as run } from "@/lib/label";\n'],
    ['', 'labels["render" + "Label"]("value")', 'import * as labels from "@/lib/label";\n'],
    ['const labels = await import("@/lib/label");', 'labels["renderLabel"]("value")'],
  ]) {
    const changed = structuredClone(fixture);
    const rewrite = (text) => extraImport + text.replace('const run = renderLabel;', reference).replace('run("value")', invocation);
    changed.sources['src/components/Panel.tsx'] = rewrite(before);
    changed.files[1] = patch('src/components/Panel.tsx', rewrite(before), rewrite(after), 'modified');
    assert.deepEqual((await gate).flagRemovalOnly(changed.files, changed.productionModes, changed.sources), [], invocation);
    assert.doesNotMatch((await decision(changed)).description, /^Flag removal only/, invocation);
  }
});

test('round 4: unchanged callers are excluded from contract proof', async () => {
  const before = 'import { isFeatureEnabled } from "@/lib/flags";\n' +
    'import { HTPR_1_PANEL_FLAG } from "@/lib/flags/keys";\n' +
    'import { renderLabel } from "@/lib/label";\n' +
    'export async function Panel() {\n' +
    '  const panelEnabled = await isFeatureEnabled(HTPR_1_PANEL_FLAG, userId);\n' +
    '  const label = await renderLabel("value", panelEnabled);\n' +
    '  return <ExistingPanel label={label} enabled={panelEnabled} />;\n}\n';
  const after = before.replace(/^import .*flags[^\n]*\n/gm, '').replace(/^  const panelEnabled = .*\n/m, '')
    .replace('"value", panelEnabled', '"value"').replace('enabled={panelEnabled}', 'enabled={true}');
  const fixture = removalFixture({ before, after });
  const filename = 'src/lib/label.ts';
  const original = 'export async function renderLabel(value, panelEnabled = false) {\n  return present(value, panelEnabled);\n}\n';
  const retained = 'export async function renderLabel(value) {\n  return present(value, true);\n}\n';
  fixture.sources[filename] = original;
  fixture.files.push(patch(filename, original, retained, 'modified'));
  const directory = mkdtempSync(path.join(tmpdir(), 'ux-signoff-unchanged-'));
  try {
    const script = path.join(directory, '.github/scripts/ux-signoff-gate.mjs');
    mkdirSync(path.dirname(script), { recursive: true });
    writeFileSync(script, readFileSync(process.env.UX_SIGNOFF_GATE_PATH || path.join(root, '.github/scripts/ux-signoff-gate.mjs')));
    writeFileSync(path.join(path.dirname(script), 'github-rate-limit.mjs'), readFileSync(path.join(root, '.github/scripts/github-rate-limit.mjs')));
    for (const [relative, source] of Object.entries({ ...fixture.sources,
      'e2e/smoke/production-flag-modes.json': JSON.stringify(fixture.productionModes),
      'src/components/Unchanged.tsx': 'import { renderLabel } from "@/lib/label";\nexport const Unchanged = () => renderLabel("value");\n',
    })) {
      const target = path.join(directory, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, source);
    }
    const isolated = await import(pathToFileURL(script));
    const output = [];
    assert.equal(await isolated.run(['--pr', '1'], {
      env,
      github: async (endpoint) => endpoint.includes('/files?') ? fixture.files : {
        number: 1, title: 'HTPR-1 [REFACTOR] Remove flag', user: { login: 'builder' }, changed_files: fixture.files.length,
      },
      fetchImpl: commentsFetch,
      log: (line) => output.push(JSON.parse(line)),
    }), 0);
    assert.doesNotMatch(output[0].description, /^Flag removal only/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('round 4: OR folding can change a function receiver', async () => {
  for (const [expression, retained] of [
    ['((panelEnabled || fallback) && settings.tag)()', '(settings.tag)()'],
    ['((panelEnabled || fallback) && settings.tag)`text`', '(settings.tag)`text`'],
    ['((panelEnabled || fallback) && settings.tag)?.()', '(settings.tag)?.()'],
    ['((panelEnabled || fallback) && settings.tag).name', '(settings.tag).name'],
    ['new ((panelEnabled || fallback) && settings.Tag)()', 'new (settings.Tag)()'],
    ['delete ((panelEnabled || fallback) && settings.value)', 'delete (settings.value)'],
    ['typeof ((panelEnabled || fallback) && missing)', 'typeof (missing)'],
  ]) {
    const fixture = booleanRemovalFixture(expression, retained);
    assert.deepEqual((await gate).flagRemovalOnly(fixture.files, fixture.productionModes, fixture.sources), [], expression);
    assert.doesNotMatch((await decision(fixture)).description, /^Flag removal only/, expression);
  }
});

test('round 5: logical folding keeps statement-position expressions as expressions', async () => {
  for (const [statement, retained] of [
    ['panelEnabled && function render() { return "new"; };', 'function render() { return "new"; };'],
    ['panelEnabled && class render {};', 'class render {};'],
    ['panelEnabled && async function render() {};', 'async function render() {};'],
  ]) {
    const before = 'import { useFlag } from "@/hooks/useFlag";\n' +
      'import { HTPR_1_PANEL_FLAG } from "@/lib/flags/keys";\n' +
      'export function Panel({ render }) {\n  const panelEnabled = useFlag(HTPR_1_PANEL_FLAG);\n' +
      `  {\n    ${statement}\n    return <ExistingPanel render={render} />;\n  }\n}\n`;
    const after = before.replace(/^import .*\n/gm, '').replace(/^  const panelEnabled = .*\n/m, '').replace(statement, retained);
    const fixture = removalFixture({ before, after });
    assert.deepEqual((await gate).flagRemovalOnly(fixture.files, fixture.productionModes, fixture.sources), [], statement);
    assert.doesNotMatch((await decision(fixture)).description, /^Flag removal only/, statement);
  }
});

test('round 5: removing a flag declaration cannot join the statements around it', async () => {
  const panel = (consume, next) => {
    const before = 'import { useFlag } from "@/hooks/useFlag";\n' +
      'import { HTPR_1_PANEL_FLAG } from "@/lib/flags/keys";\n' +
      `export function Panel({ value, render, consume }) {\n  ${consume}\n  const panelEnabled = useFlag(HTPR_1_PANEL_FLAG);\n` +
      `  ${next}\n  return <ExistingPanel />;\n}\n`;
    const after = before.replace(/^import .*\n/gm, '').replace(/^  const panelEnabled = .*\n/m, '').replace('panelEnabled && ', '');
    return removalFixture({ before, after });
  };
  for (const next of ['[panelEnabled && value].forEach(render);', '(panelEnabled && value).forEach(render);']) {
    const fixture = panel('consume()', next);
    assert.deepEqual((await gate).flagRemovalOnly(fixture.files, fixture.productionModes, fixture.sources), [], next);
    assert.doesNotMatch((await decision(fixture)).description, /^Flag removal only/, next);
  }
  const allowed = panel('consume();', '[panelEnabled && value].forEach(render);');
  assert.deepEqual((await gate).flagRemovalOnly(allowed.files, allowed.productionModes, allowed.sources), ['htpr-1-panel']);
});

test('round 6: comments cannot stand in for code boundaries or operators', async () => {
  const header = 'import { useFlag } from "@/hooks/useFlag";\n' +
    'import { HTPR_1_PANEL_FLAG } from "@/lib/flags/keys";\n';
  for (const [body, change] of [
    ['export function Panel({ render }) {\n  const panelEnabled = useFlag(HTPR_1_PANEL_FLAG);\n  {\n' +
      '    panelEnabled && /* keep */ function render() { return "new"; };\n    return <ExistingPanel render={render} />;\n  }\n}\n',
    (text) => text.replace('panelEnabled && ', '')],
    ['export function Panel({ value, render, consume }) {\n  consume() // ;\n  const panelEnabled = useFlag(HTPR_1_PANEL_FLAG);\n' +
      '  [panelEnabled && value].forEach(render);\n  return <ExistingPanel />;\n}\n',
    (text) => text.replace('panelEnabled && ', '')],
    ['export function Panel({ x, value }) {\n  const panelEnabled = useFlag(HTPR_1_PANEL_FLAG);\n' +
      '  const total = x + // return\n    panelEnabled && value;\n  return <ExistingPanel total={total} />;\n}\n',
    (text) => text.replace('panelEnabled && ', '')],
  ]) {
    const before = header + body;
    const after = change(body.replace(/^  const panelEnabled = .*\n/m, ''));
    const fixture = removalFixture({ before, after });
    assert.deepEqual((await gate).flagRemovalOnly(fixture.files, fixture.productionModes, fixture.sources), [], body);
    assert.doesNotMatch((await decision(fixture)).description, /^Flag removal only/, body);
  }
});

test('round 7: logical folding never leaves a line break right after the removed flag', async () => {
  for (const tail of ['// keep\n    <ExistingPanel />', '/* keep\n */ <ExistingPanel />']) {
    const before = 'import { useFlag } from "@/hooks/useFlag";\n' +
      'import { HTPR_1_PANEL_FLAG } from "@/lib/flags/keys";\n' +
      'export function Panel() {\n  const panelEnabled = useFlag(HTPR_1_PANEL_FLAG);\n' +
      `  return panelEnabled && ${tail};\n}\n`;
    const after = before.replace(/^import .*\n/gm, '').replace(/^  const panelEnabled = .*\n/m, '').replace('panelEnabled && ', '');
    const fixture = removalFixture({ before, after });
    assert.deepEqual((await gate).flagRemovalOnly(fixture.files, fixture.productionModes, fixture.sources), [], tail);
    assert.doesNotMatch((await decision(fixture)).description, /^Flag removal only/, tail);
  }
});

test('round 8: carriage returns and Unicode line separators keep normal sign-off', async () => {
  for (const terminator of ['\r', '\u2028', '\u2029']) {
    const before = 'import { useFlag } from "@/hooks/useFlag";\n' +
      'import { HTPR_1_PANEL_FLAG } from "@/lib/flags/keys";\n' +
      'export function Panel() {\n  const panelEnabled = useFlag(HTPR_1_PANEL_FLAG);\n' +
      `  return panelEnabled && /* keep${terminator} */ <ExistingPanel />;\n}\n`;
    const after = before.replace(/^import .*\n/gm, '').replace(/^  const panelEnabled = .*\n/m, '').replace('panelEnabled && ', '');
    const fixture = removalFixture({ before, after });
    assert.deepEqual((await gate).flagRemovalOnly(fixture.files, fixture.productionModes, fixture.sources), [], JSON.stringify(terminator));
    assert.doesNotMatch((await decision(fixture)).description, /^Flag removal only/, JSON.stringify(terminator));
  }
});

test('round 9: a property named return is a value, so the slash after it divides', async () => {
  for (const property of ['obj.return', 'obj?.return', 'obj. return']) {
    const before = 'import { useFlag } from "@/hooks/useFlag";\n' +
      'import { HTPR_1_PANEL_FLAG } from "@/lib/flags/keys";\n' +
      'export function Panel({ obj, text }) {\n  const panelEnabled = useFlag(HTPR_1_PANEL_FLAG);\n' +
      `  const ratio = ${property} / /return panelEnabled && return/.test(text) / 1;\n  return <ExistingPanel ratio={ratio} />;\n}\n`;
    const after = before.replace(/^import .*\n/gm, '').replace(/^  const panelEnabled = .*\n/m, '').replace('panelEnabled && ', '');
    const fixture = removalFixture({ before, after });
    assert.deepEqual((await gate).flagRemovalOnly(fixture.files, fixture.productionModes, fixture.sources), [], property);
    assert.doesNotMatch((await decision(fixture)).description, /^Flag removal only/, property);
  }
});

test('round 10: files with a regex keep normal sign-off for logical and ternary folding', async () => {
  for (const [line, change] of [
    ['  const ratio = value! / Number(/ return panelEnabled && return/.test(text)) / 1;\n  return <ExistingPanel ratio={ratio} />;\n', (text) => text.replace('panelEnabled && ', '')],
    ['  const ok = /x/.test(text);\n  return <ExistingPanel ok={ok} visible={panelEnabled && value} />;\n', (text) => text.replace('panelEnabled && ', '')],
    ['  const ok = /x/.test(text);\n  return <ExistingPanel ok={ok} label={panelEnabled ? "on" : "off"} />;\n', (text) => text.replace('panelEnabled ? "on" : "off"', '"on"')],
  ]) {
    const before = 'import { useFlag } from "@/hooks/useFlag";\n' +
      'import { HTPR_1_PANEL_FLAG } from "@/lib/flags/keys";\n' +
      'export function Panel({ value, text }) {\n  const panelEnabled = useFlag(HTPR_1_PANEL_FLAG);\n' + line + '}\n';
    const after = change(before.replace(/^import .*\n/gm, '').replace(/^  const panelEnabled = .*\n/m, ''));
    const fixture = removalFixture({ before, after });
    assert.deepEqual((await gate).flagRemovalOnly(fixture.files, fixture.productionModes, fixture.sources), [], line);
    assert.doesNotMatch((await decision(fixture)).description, /^Flag removal only/, line);
  }
});

test('round 11: files with a regex keep normal sign-off for call guards and early returns too', async () => {
  for (const [line, change] of [
    ['  const ratio = value! / Number(/; if (panelEnabled) foo(); return /.test(text)) / 1;\n', (text) => text.replace('if (panelEnabled) ', '')],
    ['  const ok = /x/.test(text);\n  if (panelEnabled) foo();\n', (text) => text.replace('if (panelEnabled) ', '')],
    ['  const ok = /x/.test(text);\n  if (!panelEnabled) return;\n', (text) => text.replace('  if (!panelEnabled) return;\n', '')],
  ]) {
    const before = 'import { useFlag } from "@/hooks/useFlag";\n' +
      'import { HTPR_1_PANEL_FLAG } from "@/lib/flags/keys";\n' +
      'export function Panel({ value, text, foo }) {\n  const panelEnabled = useFlag(HTPR_1_PANEL_FLAG);\n' + line +
      '  return <ExistingPanel />;\n}\n';
    const after = change(before.replace(/^import .*\n/gm, '').replace(/^  const panelEnabled = .*\n/m, ''));
    const fixture = removalFixture({ before, after });
    assert.deepEqual((await gate).flagRemovalOnly(fixture.files, fixture.productionModes, fixture.sources), [], line);
    assert.doesNotMatch((await decision(fixture)).description, /^Flag removal only/, line);
  }
});

test('round 4: derived aliases can capture shadowed bindings', async () => {
  for (const binding of [
    'const { other } = data;', 'const [other] = data;', 'let other = data;',
    'function other() {}', 'class other {}', 'const child = (other) => other;',
    'try {} catch (other) {}', 'for (const other of data) {}', 'for (const other in data) {}',
    'const child = function other() {};', 'const child = class other {};',
  ]) {
    const before = 'import { useFlag } from "@/hooks/useFlag";\n' +
      'import { HTPR_1_PANEL_FLAG } from "@/lib/flags/keys";\n' +
      'export function Panel() {\n' +
      '  const panelEnabled = useFlag(HTPR_1_PANEL_FLAG);\n' +
      '  const other = false;\n  const visible = panelEnabled && other;\n' +
      `  { ${binding}\n    return <ExistingPanel enabled={visible} />;\n  }\n}\n`;
    const after = before.replace(/^import .*\n/gm, '').replace(/^  const panelEnabled = .*\n/m, '')
      .replace('  const visible = panelEnabled && other;\n', '').replace('enabled={visible}', 'enabled={other}');
    const fixture = removalFixture({ before, after });
    assert.deepEqual((await gate).flagRemovalOnly(fixture.files, fixture.productionModes, fixture.sources), [], binding);
    assert.doesNotMatch((await decision(fixture)).description, /^Flag removal only/, binding);
  }
});

test('projection audit: local flag reads cannot escape their declaration scope', async () => {
  const before = 'import { useFlag } from "@/hooks/useFlag";\n' +
    'import { HTPR_1_PANEL_FLAG } from "@/lib/flags/keys";\n' +
    'export function First() {\n  const panelEnabled = useFlag(HTPR_1_PANEL_FLAG);\n' +
    '  return <ExistingPanel enabled={panelEnabled} />;\n}\n' +
    'export function Second() {\n  return <ExistingPanel enabled={panelEnabled} />;\n}\n';
  const after = before.replace(/^import .*\n/gm, '').replace(/^  const panelEnabled = .*\n/m, '')
    .replaceAll('enabled={panelEnabled}', 'enabled={true}');
  assert.doesNotMatch((await decision(removalFixture({ before, after }))).description, /^Flag removal only/);
});

test('projection audit: flag and React hook shadow bindings are refused', async () => {
  const base = removalFixture();
  for (const binding of [
    'function useFlag(HTPR_1_PANEL_FLAG) { return false; }',
    'function Child(useFlag) {}',
    'function /* comment */ useFlag(OTHER_FLAG) /* comment */ { return false; }',
    'const { useFlag } = hooks;',
    'function useEffect(callback, deps) { return deps.length; }',
    'const { useEffect } = hooks;',
    'const useEffect = customEffect;',
  ]) {
    const before = base.sources['src/components/Panel.tsx']
      .replace('export default async function Panel() {',
        'import { useEffect } from "react";\nexport default async function Panel() {\n  ' + binding)
      .replace('  return (', '  useEffect(() => {}, [panelEnabled]);\n  return (');
    const after = before.replace(/^import .*flags[^\n]*\n/gm, '').replace(/^import .*useFlag[^\n]*\n/gm, '')
      .replace(/^  const panelEnabled = .*\n/m, '').replace('[panelEnabled]', '[]')
      .replace('      {panelEnabled && (\n        <button>Existing action</button>\n      )}\n',
        '      <button>Existing action</button>\n');
    assert.doesNotMatch((await decision(removalFixture({ before, after }))).description, /^Flag removal only/, binding);
  }
});

test('projection audit: member hook calls do not prove dependency-array cleanup', async () => {
  for (const callee of ['hooks.useEffect', 'hooks . useEffect', 'hooks?.useEffect', 'hooks. /* comment */ useEffect']) {
    const base = removalFixture();
    const before = base.sources['src/components/Panel.tsx'].replace('export default', 'import { useEffect } from "react";\nexport default')
      .replace('  return (', `  ${callee}(() => {}, [panelEnabled]);\n  return (`);
    const after = before.replace(/^import .*flags[^\n]*\n/gm, '').replace(/^import .*useFlag[^\n]*\n/gm, '')
      .replace(/^  const panelEnabled = .*\n/m, '').replace('[panelEnabled]', '[]')
      .replace('      {panelEnabled && (\n        <button>Existing action</button>\n      )}\n',
        '      <button>Existing action</button>\n');
    assert.doesNotMatch((await decision(removalFixture({ before, after }))).description, /^Flag removal only/, callee);
  }
});

test('projection audit: reductions require plain value-consuming parentheses', async () => {
  for (const [expression, retained] of [
    ['delete /* comment */ (panelEnabled && settings.value)', 'delete /* comment */ (settings.value)'],
    ['typeof /* comment */ (panelEnabled ? missing : fallback)', 'typeof /* comment */ (missing)'],
    ['(panelEnabled && settings.method)!()', '(settings.method)!()'],
    ['(panelEnabled && settings.method as Callable)()', '(settings.method as Callable)()'],
    ['new /* comment */ (panelEnabled && settings.Constructor)()', 'new /* comment */ (settings.Constructor)()'],
  ]) {
    assert.doesNotMatch((await decision(booleanRemovalFixture(expression, retained))).description, /^Flag removal only/, expression);
  }
});

test('projection audit: dynamic lexical references are refused', async () => {
  const base = removalFixture();
  for (const statement of ['  const label = eval("panelEnabled");\n', '  with (data) { consume(panelEnabled); }\n']) {
    const before = base.sources['src/components/Panel.tsx'].replace('  return (', statement + '  return (');
    const after = before.replace(/^import .*\n/gm, '').replace(/^  const panelEnabled = .*\n/m, '')
      .replace('      {panelEnabled && (\n        <button>Existing action</button>\n      )}\n',
        '      <button>Existing action</button>\n');
    assert.doesNotMatch((await decision(removalFixture({ before, after }))).description, /^Flag removal only/, statement);
  }
});

test('object ternary folding refuses comparison operands', async () => {
  for (const operator of ['===', '==', '!==', '!=', '<=', '>=', '+=', '^=']) {
    const fixture = removalFixture();
    const filename = 'src/components/Panel.tsx';
    const before = fixture.sources[filename].replace('  return (', `  const label = value ${operator} true ? { label: "A" } : fallback;\n  return (`);
    const after = 'export default async function Panel() {\n' +
      `  const label = value ${operator} { label: "A" };\n` +
      '  return (\n    <main>\n      <button>Existing action</button>\n    </main>\n  );\n}\n';
    const changed = removalFixture({ before, after });
    assert.deepEqual((await gate).flagRemovalOnly(changed.files, changed.productionModes, changed.sources), [], operator);
    assert.doesNotMatch((await decision(changed)).description, /^Flag removal only/, operator);
  }
});

test('ternary reduction refuses receiver-sensitive tagged templates', async () => {
  for (const condition of ['panelEnabled ? settings.tag : fallback', 'panelEnabled && settings.tag']) {
    for (const suffix of ['`text`', ' `text`', '\n`text`', '/* tag */`text`']) {
      const fixture = booleanRemovalFixture(`(${condition})${suffix}`, `(settings.tag)${suffix}`);
      assert.deepEqual((await gate).flagRemovalOnly(fixture.files, fixture.productionModes, fixture.sources), [], condition + suffix);
      assert.doesNotMatch((await decision(fixture)).description, /^Flag removal only/, condition + suffix);
    }
  }
});

test('ternary reduction refuses nullish coalescing boundaries', async () => {
  for (const [expression, retained] of [
    ['value ?? panelEnabled ? "A" : "B"', 'value ?? "A"'],
    ['value ?? !panelEnabled ? "B" : "A"', 'value ?? "A"'],
  ]) {
    const fixture = booleanRemovalFixture(expression, retained);
    assert.deepEqual((await gate).flagRemovalOnly(fixture.files, fixture.productionModes, fixture.sources), [], expression);
    assert.doesNotMatch((await decision(fixture)).description, /^Flag removal only/, expression);
  }
});

test('JSX unwrapping refuses multiline template whitespace changes', async () => {
  const fixture = removalFixture();
  const filename = 'src/components/Panel.tsx';
  const before = fixture.sources[filename].replace('<button>Existing action</button>', '<pre>{`first\n          second`}</pre>');
  const after = 'export default async function Panel() {\n' +
    '  return (\n    <main>\n      <pre>{`first\n        second`}</pre>\n    </main>\n  );\n}\n';
  const changed = removalFixture({ before, after });
  assert.deepEqual((await gate).flagRemovalOnly(changed.files, changed.productionModes, changed.sources), []);
  assert.doesNotMatch((await decision(changed)).description, /^Flag removal only/);
});

function booleanRemovalFixture(expression, retained, { derived = false } = {}) {
  const imports = 'import { useFlag } from "@/hooks/useFlag";\nimport { HTPR_1_PANEL_FLAG } from "@/lib/flags/keys";\n';
  const declaration = '  const panelEnabled = useFlag(HTPR_1_PANEL_FLAG);\n';
  const stable = derived ? '  const layoutEnabled = true;\n' : '';
  const body = (value) => `  return <ExistingPanel enabled={${value}} />;\n}\n`;
  const before = imports + 'export function Panel() {\n' + declaration + stable +
    (derived ? `  const enabled = ${expression};\n` + body('enabled') : body(expression));
  return removalFixture({ before, after: 'export function Panel() {\n' + stable + body(retained) });
}

for (const [name, fixture] of [
  ['PR 1910: inbox flag removed from a nested boolean guard', () => {
    const before = 'import { useFlag } from "@/hooks/useFlag";\n' +
      'import { HTPR_1_PANEL_FLAG } from "@/lib/flags/keys";\n' +
      'export function Panel() {\n' +
      '  const inboxEFirstPress = useFlag(HTPR_1_PANEL_FLAG);\n' +
      '  if (refresh && !(inboxEFirstPress && window.history.state?.cachedTaskDetail &&\n' +
      '    new URLSearchParams(window.location.search).get("inboxFlow") === "true")) {\n' +
      '    navigate(refreshPath);\n  }\n' +
      '  return <ExistingPanel />;\n}\n';
    const after = before.replace(/^import .*\n/gm, '')
      .replace(/^  const inboxEFirstPress = .*\n/m, '').replace('inboxEFirstPress && ', '');
    return removalFixture({ before, after });
  }],
  ['PR 1931: boolean branch unthreaded from a JSX prop call', () => {
    const before = 'import { useFlag } from "@/hooks/useFlag";\n' +
      'import { HTPR_1_PANEL_FLAG } from "@/lib/flags/keys";\n' +
      'export function Panel() {\n' +
      '  const commenterFlagEnabled = useFlag(HTPR_1_PANEL_FLAG);\n' +
      '  return <TaskListRow titleParts={highlightedTitle(task.title, inputValue, commenterFlagEnabled && layoutEnabled)} />;\n}\n';
    const after = before.replace(/^import .*\n/gm, '')
      .replace(/^  const commenterFlagEnabled = .*\n/m, '').replace('commenterFlagEnabled && ', '');
    return removalFixture({ before, after });
  }],
  ['boolean prop retains true', () => booleanRemovalFixture('panelEnabled', 'true')],
  ['boolean prop retains shorthand true', () => {
    const fixture = booleanRemovalFixture('panelEnabled', 'true');
    fixture.files[1].patch = fixture.files[1].patch.replace('+  return <ExistingPanel enabled={true}', '+  return <ExistingPanel enabled');
    return fixture;
  }],
  ['and branch', () => booleanRemovalFixture('panelEnabled && layoutEnabled', 'layoutEnabled')],
  ['true ternary branch', () => booleanRemovalFixture('panelEnabled ? "Existing" : "Legacy"', '"Existing"')],
  ['negated ternary false branch', () => booleanRemovalFixture('!panelEnabled ? "Legacy" : "Existing"', '"Existing"')],
]) {
  test(`boolean removal now passes: ${name}`, async () => {
    const result = await decision({ ...fixture(), title: 'HTPR-1 [REFACTOR] Remove flag' });
    assert.deepEqual(result, {
      state: 'success', description: 'Flag removal only: htpr-1-panel already on for everyone', details: [],
    });
  });
}

test('derived boolean substitution is refused even without shadowing', async () => {
  const fixture = booleanRemovalFixture('panelEnabled && layoutEnabled', 'layoutEnabled', { derived: true });
  assert.deepEqual((await gate).flagRemovalOnly(fixture.files, fixture.productionModes, fixture.sources), []);
  assert.doesNotMatch((await decision(fixture)).description, /^Flag removal only/);
});

for (const [name, expression, retained] of [
  ['and expression must not become a method reference', '(panelEnabled && settings.method)()', '(settings.method)()'],
  ['ternary must not become a method reference', '(panelEnabled ? settings.method : fallback)()', '(settings.method)()'],
  ['conditional delete must not become a property deletion', 'delete (panelEnabled && settings.value)', 'delete (settings.value)'],
  ['typeof must still evaluate the conditional operand', 'typeof (panelEnabled ? missing : fallback)', 'typeof (missing)'],
  ['wrong side', 'panelEnabled ? "Existing" : "Legacy"', '"Legacy"'],
  ['new visible string', 'panelEnabled ? "Existing" : "Legacy"', '"New copy"'],
  ['ternary after or', 'other || panelEnabled ? left : right', 'other || left'],
  ['ternary after and', 'other && panelEnabled ? left : right', 'other && left'],
  ['equality is not an expression boundary', 'other === panelEnabled && layoutEnabled', 'other === layoutEnabled'],
  ['operator precedence', 'panelEnabled ? left : right || fallback', 'left || fallback'],
  ['negated and', '!panelEnabled && layoutEnabled', 'layoutEnabled'],
  ['member access is not the flag', 'settings.panelEnabled && layoutEnabled', 'layoutEnabled'],
  ['write is not a read', 'panelEnabled = false', 'true'],
  ['unknown call', 'transform(panelEnabled)', 'true'],
]) {
  test(`boolean removal still refused: ${name}`, async () => {
    assert.doesNotMatch((await decision({ ...booleanRemovalFixture(expression, retained), title: 'HTPR-1 [REFACTOR] Remove flag' })).description, /^Flag removal only/);
  });
}

test('flag reads and derived prop reads before initialization remain refused', async () => {
  for (const derived of [false, true]) {
    const fixture = booleanRemovalFixture('panelEnabled && layoutEnabled', 'layoutEnabled', { derived });
    let before = fixture.sources['src/components/Panel.tsx'];
    const declaration = derived ? '  const enabled = panelEnabled && layoutEnabled;\n' : '  const panelEnabled = useFlag(HTPR_1_PANEL_FLAG);\n';
    before = before.replace(declaration, '').replace(' />;\n', ` />;\n${declaration}`);
    const after = before.replace(/^import .*\n/gm, '').replace(/^  const panelEnabled = .*\n/m, '')
      .replace(/^  const enabled = .*\n/m, '').replace(derived ? 'enabled={enabled}' : 'enabled={panelEnabled && layoutEnabled}', 'enabled={layoutEnabled}');
    assert.doesNotMatch((await decision({ ...removalFixture({ before, after }), title: 'HTPR-1 [REFACTOR] Remove flag' })).description, /^Flag removal only/);
  }
});

test('boolean prop omission without a proven default is refused', async () => {
  const fixture = booleanRemovalFixture('panelEnabled', 'true');
  fixture.files[1].patch = fixture.files[1].patch.replace('+  return <ExistingPanel enabled={true}', '+  return <ExistingPanel');
  assert.doesNotMatch((await decision({ ...fixture, title: 'HTPR-1 [REFACTOR] Remove flag' })).description, /^Flag removal only/);
});

for (const [name, rewrite] of [
  ['mutable retained binding', (source) => source.replace('const layoutEnabled = true', 'let layoutEnabled = true')],
  ['retained binding in another scope', (source) => source.replace('  const layoutEnabled = true;\n', '').replace('export function Panel()', 'const layoutEnabled = true;\nexport function Panel()')],
  ['retained name shadowed in a nested function', (source) => source.replace('  return <ExistingPanel', '  function Child(layoutEnabled) {\n  return <ExistingPanel').replace(' />;\n}', ' />;\n  }\n}')],
  ['flag name shadowed in a nested function', (source) => source.replace('  return <ExistingPanel', '  function Child(panelEnabled) {\n  return <ExistingPanel').replace(' />;\n}', ' />;\n  }\n}')],
]) {
  test(`derived boolean remains fail-closed: ${name}`, async () => {
    const fixture = booleanRemovalFixture('panelEnabled && layoutEnabled', 'layoutEnabled', { derived: true });
    const before = rewrite(fixture.sources['src/components/Panel.tsx']);
    const after = before.replace(/^import .*\n/gm, '').replace(/^  const panelEnabled = .*\n/m, '')
      .replace(/^  const enabled = .*\n/m, '').replace('enabled={enabled}', 'enabled={layoutEnabled}');
    assert.doesNotMatch((await decision({ ...removalFixture({ before, after }), title: 'HTPR-1 [REFACTOR] Remove flag' })).description, /^Flag removal only/);
  });
}

for (const [name, use, retained] of [
  ['object shorthand keeps its key', 'const result = { enabled };', 'const result = { layoutEnabled };'],
  ['postfix writes are not reads', 'enabled++;', 'layoutEnabled++;'],
  ['compound writes are not reads', 'enabled ||= false;', 'layoutEnabled ||= false;'],
]) {
  test(`derived boolean still refuses ${name}`, async () => {
    const fixture = booleanRemovalFixture('panelEnabled && layoutEnabled', 'layoutEnabled', { derived: true });
    const before = fixture.sources['src/components/Panel.tsx'].replace('  return ', `  ${use}\n  return `);
    const after = before.replace(/^import .*\n/gm, '').replace(/^  const panelEnabled = .*\n/m, '').replace(/^  const enabled = .*\n/m, '').replace(use, retained).replace('enabled={enabled}', 'enabled={layoutEnabled}');
    assert.doesNotMatch((await decision({ ...removalFixture({ before, after }), title: 'HTPR-1 [REFACTOR] Remove flag' })).description, /^Flag removal only/);
  });
}

test('removing a flag guard cannot rebind an else through a comment or an outer condition', async () => {
  const imports = 'import { useFlag } from "@/hooks/useFlag";\nimport { HTPR_1_PANEL_FLAG } from "@/lib/flags/keys";\n';
  for (const outer of ['', '  if (outer)\n']) {
    const body = outer + '    if (panelEnabled) perform();\n    /* */ else fallback();\n  return <ExistingPanel />;\n}\n';
    const before = imports + 'export function Panel() {\n  const panelEnabled = useFlag(HTPR_1_PANEL_FLAG);\n' + body;
    const after = 'export function Panel() {\n' + body.replace('if (panelEnabled) ', '');
    assert.doesNotMatch((await decision({ ...removalFixture({ before, after }), title: 'HTPR-1 [REFACTOR] Remove flag' })).description, /^Flag removal only/);
  }
});

test('boolean cleanup cannot hide new JSX, a renamed component or visible text', async () => {
  for (const retained of ['layoutEnabled', 'layoutEnabled} /><aside>New</aside><ExistingPanel enabled={layoutEnabled']) {
    const fixture = booleanRemovalFixture('panelEnabled && layoutEnabled', retained);
    if (retained === 'layoutEnabled') fixture.files[1].patch = fixture.files[1].patch.replace('+  return <ExistingPanel', '+  return <NewPanel');
    assert.doesNotMatch((await decision({ ...fixture, title: 'HTPR-1 [REFACTOR] Remove flag' })).description, /^Flag removal only/);
  }
  assert.doesNotMatch((await decision({ title: 'HTPR-1 [REFACTOR] Change UI', files: [modified] })).description, /^Flag removal only/);
});

for (const [context, open, close] of [
  ['double-quoted JSX attribute', '<main title="', '">'],
  ['single-quoted JSX attribute', "<main title='", "'>"],
  ['template literal', '<main>{`', '`}'],
  ['block comment', '<main>{/*', '*/}'],
  ['string literal with invalid raw newlines', '<main>{"', '"}'],
  ['single-quoted string with invalid raw newlines', "<main>{'", "'}"],
]) {
  test(`flag-like wrapper in ${context} cannot exempt a literal-text rewrite`, async () => {
    const clean = removalFixture();
    await assertRemovalProven(clean);
    const before = clean.sources['src/components/Panel.tsx']
      .replace('    <main>', `    ${open}`)
      .replace('    </main>', `    ${close}\n    </main>`);
    const after = before.replace(/^import .*\n/gm, '')
      .replace(/^  const panelEnabled = .*\n/m, '')
      .replace('      {panelEnabled && (\n        <button>Existing action</button>\n      )}\n',
        '      <button>Existing action</button>\n');
    await assertRemovalUnproven(removalFixture({ before, after }));
  });
}

test('the built-in scanner exempts real removals with no TypeScript available', async () => {
  const original = process.env.FEATURE_FLAG_TYPESCRIPT_PATH;
  try {
    process.env.FEATURE_FLAG_TYPESCRIPT_PATH = path.join(root, 'missing-ux-signoff-typescript.cjs');
    const withoutTypescript = await import(`${pathToFileURL(process.env.UX_SIGNOFF_GATE_PATH || path.join(root, '.github/scripts/ux-signoff-gate.mjs'))}?no-typescript`);
    const fixture = removalFixture();
    assert.deepEqual(withoutTypescript.flagRemovalOnly(fixture.files, fixture.productionModes, fixture.sources), ['htpr-1-panel']);
    assert.match(withoutTypescript.evaluate(input(removalFixture())).description, /^Flag removal only/);
    assert.match(withoutTypescript.evaluate(input({ ...removalFixture(), comments: [wireframe(), yes()] })).description, /^Flag removal only/);
  } finally {
    if (original === undefined) delete process.env.FEATURE_FLAG_TYPESCRIPT_PATH;
    else process.env.FEATURE_FLAG_TYPESCRIPT_PATH = original;
  }
});

test('the scanner keeps quoted JSX text, ordinary strings, comments and expression braces distinct', async () => {
  const clean = removalFixture();
  const before = clean.sources['src/components/Panel.tsx']
    .replace('  return (', '  const label = "{notCode}";\n  // {notCode}\n  /* {notCode} */\n  return (')
    .replace('<main>', '<main title="{notCode}" data-count={1}>Don\'t treat this "quote as code');
  const after = before.replace(/^import .*\n/gm, '')
    .replace(/^  const panelEnabled = .*\n/m, '')
    .replace('      {panelEnabled && (\n        <button>Existing action</button>\n      )}\n',
      '      <button>Existing action</button>\n');
  await assertRemovalProven(removalFixture({ before, after }));
});

for (const [context, rewrite] of [
  ['unbalanced brace', (source) => source.replace('  return (', '  {\n  return (')],
  ['unbalanced parenthesis', (source) => source.replace('  return (', '  (\n  return (')],
  ['line continuation', (source) => source.replace('  return (', '  const text = "line' + '\\' + '\n' + 'continuation";\n  return (')],
  ['multiline attribute string', (source) => source.replace('<main>', '<main title="first\nsecond">')],
  ['mismatched JSX tags', (source) => source.replace('</main>', '</aside>')],
]) {
  test(`the scanner refuses ${context} even when it is preserved`, async () => {
    const clean = removalFixture();
    const before = rewrite(clean.sources['src/components/Panel.tsx']);
    const after = before.replace(/^import .*\n/gm, '')
      .replace(/^  const panelEnabled = .*\n/m, '')
      .replace('      {panelEnabled && (\n        <button>Existing action</button>\n      )}\n',
        '      <button>Existing action</button>\n');
    await assertRemovalUnproven(removalFixture({ before, after }));
  });
}

test('a canonical wrapper can also be a plain expression statement, not an object value', async () => {
  const clean = removalFixture();
  const before = clean.sources['src/components/Panel.tsx']
    .replace('  return (\n    <main>\n', '').replace('    </main>\n  );\n', '');
  const after = before.replace(/^import .*\n/gm, '')
    .replace(/^  const panelEnabled = .*\n/m, '')
    .replace('      {panelEnabled && (\n        <button>Existing action</button>\n      )}\n',
      '      <button>Existing action</button>\n');
  await assertRemovalProven(removalFixture({ before, after }));
  await assertRemovalUnproven(removalFixture({
    before: before.replace('      {panelEnabled', '  const value = (\n      {panelEnabled').replace('      )}\n', '      )}\n  );\n'),
    after: after.replace('      <button>', '  const value = (\n      <button>').replace('</button>\n', '</button>\n  );\n'),
  }));
});

test('a wrapper in a JavaScript comment is not a plain expression statement', async () => {
  const clean = removalFixture();
  const plain = clean.sources['src/components/Panel.tsx']
    .replace('  return (\n    <main>\n', '').replace('    </main>\n  );\n', '');
  for (const [open, close] of [['  /*\n', '  */\n'], ['  // ', '']]) {
    const before = plain.replace('      {panelEnabled', `${open}      {panelEnabled`)
      .replace('      )}\n', `      )}\n${close}`);
    const after = before.replace(/^import .*\n/gm, '')
      .replace(/^  const panelEnabled = .*\n/m, '')
      .replace('      {panelEnabled && (\n        <button>Existing action</button>\n      )}\n',
        '      <button>Existing action</button>\n');
    await assertRemovalUnproven(removalFixture({ before, after }));
  }
});

for (const mode of ['OWNER_ONLY', 'OWNER_AND_QA', 'OFF', undefined]) {
  test(`removal of a ${mode ?? 'missing'} production mode is not proven; a new component still needs the wireframe yes`, async () => {
    await assertRemovalProven(removalFixture());
    const refused = removalFixture({ mode });
    if (mode === undefined) delete refused.productionModes.modes['htpr-1-panel'];
    await assertRemovalUnproven(refused);
  });
}

for (const change of [
  (fixture) => { delete fixture.productionModes; },
  (fixture) => { delete fixture.files[1].patch; },
  (fixture) => { fixture.files[1].additions++; },
  (fixture) => { fixture.files[1].patch = fixture.files[1].patch.replace('Existing action</button>', 'Changed action</button>'); },
  (fixture) => { fixture.sources['src/components/Panel.tsx'] = fixture.sources['src/components/Panel.tsx'].replace('Existing action', 'Other action'); },
  (fixture) => { fixture.files[0].status = 'modified'; },
  (fixture) => { fixture.files[1].status = 'renamed'; },
  (fixture) => { fixture.files.push({ filename: 'docs/Panel.md', previous_filename: 'src/components/Other.tsx', status: 'renamed' }); },
  (fixture) => { fixture.files.push({ filename: 'src/lib/unrelated.ts', status: 'modified' }); },
]) {
  test(`unproven removal fails closed: ${change.toString()}`, async () => {
    await assertRemovalProven(removalFixture());
    const refused = removalFixture();
    change(refused);
    await assertRemovalUnproven(refused);
  });
}

test('complete context hunks prove the same removal; truncated or misplaced hunks do not', async () => {
  const fixture = removalFixture();
  fixture.files[1] = { ...fixture.files[1], additions: 1, deletions: 6, patch: [
    '@@ -1,4 +1,1 @@',
    '-import { useFlag } from "@/hooks/useFlag";',
    '-import { HTPR_1_PANEL_FLAG } from "@/lib/flags/keys";',
    ' export default async function Panel() {',
    '-  const panelEnabled = useFlag(HTPR_1_PANEL_FLAG);',
    '@@ -6,5 +3,3 @@',
    '     <main>',
    '-      {panelEnabled && (',
    '-        <button>Existing action</button>',
    '-      )}',
    '+      <button>Existing action</button>',
    '     </main>',
  ].join('\n') };
  await assertRemovalProven(fixture);
  const badPatch = fixture.files[1].patch.replace('@@ -6,5 +3,3 @@', '@@ -6,4 +3,3 @@');
  await assertRemovalUnproven({ ...fixture, files: [fixture.files[0], { ...fixture.files[1], patch: badPatch }] });
});

for (const change of [
  (source) => source.replace('{panelEnabled && (', '{!panelEnabled && ('),
  (source) => source.replace('@/hooks/useFlag', '@/hooks/notTheFlagHook'),
  (source) => source.replace('  return (', '  /* ambiguous lexical context */\n  return ('),
  (source) => source.replace('  return (', '  const text = `not parsed`;\n  return ('),
]) {
  test(`ambiguous or non-flag-on branch keeps sign-off: ${change.toString()}`, async () => {
    const clean = removalFixture();
    await assertRemovalProven(clean);
    const filename = 'src/components/Panel.tsx';
    const before = change(clean.sources[filename]);
    const oldLines = before.slice(0, -1).split('\n');
    const newRows = clean.files[1].patch.split('\n').filter((row) => row.startsWith('+'));
    clean.sources[filename] = before;
    clean.files[1] = { ...clean.files[1], deletions: oldLines.length,
      patch: [`@@ -1,${oldLines.length} +1,${newRows.length} @@`, ...oldLines.map((line) => `-${line}`), ...newRows].join('\n') };
    await assertRemovalUnproven(clean);
  });
}

test('a canonical ternary retains the flag-on branch, never the null/off branch', async () => {
  const fixture = removalFixture();
  const filename = 'src/components/Panel.tsx';
  fixture.sources[filename] = fixture.sources[filename].replace('{panelEnabled && (', '{panelEnabled ? (').replace('      )}', '      ) : null}');
  fixture.files[1].patch = fixture.files[1].patch.replace('-      {panelEnabled && (', '-      {panelEnabled ? (').replace('-      )}', '-      ) : null}');
  await assertRemovalProven(fixture);
  const after = fixture.files[1].patch.replace('+      <button>Existing action</button>', '+      null');
  await assertRemovalUnproven({ ...fixture, files: [fixture.files[0], { ...fixture.files[1], patch: after }] });
});

test('flag cleanup mixed with new JSX, a new user-facing string or a new component file is not removal-only', async () => {
  const clean = removalFixture();
  await assertRemovalProven(clean);
  for (const addition of ['      <aside>New visible element</aside>\n', '      New user-facing copy\n']) {
    const after = 'export default async function Panel() {\n  return (\n    <main>\n      <button>Existing action</button>\n' + addition + '    </main>\n  );\n}\n';
    await assertRemovalUnproven(removalFixture({ after }));
  }
  const mixed = withNewComponent(clean);
  assert.deepEqual(await removedFlags(mixed), []);
  assert.equal((await decision(mixed)).state, 'failure');
  assert.equal((await decision({ ...mixed, comments: [wireframe(), yes({ text: 'yes\nNew elements: ExamplePanel' })] })).state, 'success');
});

test('new visible UI without a flag removal still needs the wireframe yes', async () => {
  await assertRemovalProven(removalFixture());
  const newUi = { files: [added], productionModes: { modes: { 'htpr-1-panel': 'EVERYONE' } } };
  assert.equal((await decision(newUi)).state, 'failure');
  assert.equal((await decision({ ...newUi, comments: [wireframe(), yes({ text: 'yes\nNew elements: ExamplePanel' })] })).state, 'success');
});

test('PR 1271 shape fails both wireframe and new element rules', async () => {
  const result = await decision({ files: [{ filename: 'src/app/inbox/Inbox.tsx', status: 'modified' }, added] });
  assert.equal(result.state, 'failure');
  assert.equal(result.details.length, 2);
  assert.match(result.details[0], /yes on a wireframe on HTPR-7072/);
  assert.match(result.details[1], /ExamplePanel.*yes by name/);
});

test('BUGFIX modifies existing UI without signoff but cannot add an unapproved element', async () => {
  assert.equal((await decision({ title: 'HTPR-1 [BUGFIX] Repair', files: [modified] })).state, 'success');
  const result = await decision({ title: 'HTPR-1 [BUGFIX] Repair', files: [{ ...added, filename: 'src/components/x/NewThing.tsx' }] });
  assert.equal(result.state, 'failure');
  assert.equal(result.details.length, 1);
  assert.match(result.description, /NewThing.*yes by name/);
});

test('only a Valentin approval reaction on the wireframe counts', async () => {
  for (const emoji of ['👍', '👍🏻', '👍🏼', '👍🏽', '👍🏾', '👍🏿', '✅', '👍️']) {
    assert.equal((await decision({ comments: [wireframe({ reactions: [{ userId: 6, emoji }] })] })).state, 'success');
  }
  for (const reaction of [{ userId: 7, emoji: '👍' }, { userId: '6', emoji: '✅' }, { userId: 6, emoji: '👎' }, { userId: 6, emoji: '👍', isAgent: true }, { userId: 6, emoji: '👍', agent: { displayName: 'Runner 4' } }]) {
    assert.equal((await decision({ comments: [wireframe({ reactions: [reaction] })] })).state, 'failure');
  }
  assert.equal((await decision({ comments: [wireframe(), yes({ text: 'Another comment', reactions: [{ userId: 6, emoji: '👍' }] })] })).state, 'failure');
});

const slice = (name) => ({ filename: `src/components/agents/${name}.tsx`, status: 'added' });
const sliceA = ['AgentSidebarChatCommands', 'AgentConnectGreeting', 'TerminalSessionMirror'];
const htpr7518 = (questionOverrides = {}) => ({
  title: 'HTPR-7518 [FEATURE] Agent chats open from the sidebar AI chat switcher (slice A)',
  files: [modified, ...sliceA.map(slice)],
  comments: [
    wireframe({ id: 297898, createdAt: '2026-10-22T02:26:53.149Z', agent: { displayName: 'Runner 4' },
      text: '<p>One quick yes needed.</p><p>Wireframe: https://hypertask.app/wireframes/htpr-7518</p><p>New elements: AgentSidebarChatCommands, AgentConnectGreeting, TerminalSessionMirror</p>' }),
    wireframe({ id: 299523, createdAt: '2026-10-22T21:30:30.163Z', agent: { displayName: 'HT Product Lead' }, agent_display_name: 'HT Product Lead',
      editedAt: '2026-10-22T21:32:13.990Z', editedBy: { userId: 6, agentId: 'lead', isAgent: true },
      text: '<p>Question: <strong>May slice A ship with the 3 new parts named here: AgentSidebarChatCommands, AgentConnectGreeting, TerminalSessionMirror?</strong></p><p>Details: https://app.hypertask.ai/detail/project-15/7518#comment-297898</p><p>Yes: it merges.</p><p>No: say which part to change.</p>',
      reactions: [{ id: 'r1', userId: 6, emoji: '👍', createdAt: '2026-10-22T21:33:04.880Z' }], ...questionOverrides }),
  ],
});

test('HTPR-7518: Valentin’s thumbs up on a Question approves the wireframe and the elements it names', async () => {
  assert.equal((await decision(htpr7518())).state, 'success');
  assert.equal((await decision(htpr7518({ reactions: [{ userId: 6, emoji: '✅', createdAt: '2026-10-22T21:33:04.880Z' }] }))).state, 'success');
  const namedOnlyInQuestion = htpr7518();
  namedOnlyInQuestion.comments[0].text = '<p>Wireframe: https://hypertask.app/wireframes/htpr-7518</p>';
  assert.equal((await decision(namedOnlyInQuestion)).state, 'success');
});

test('a Question thumbs up is still refused from an agent, before or at its last edit, or on a stale design', async () => {
  for (const reaction of [
    { userId: 6, emoji: '👍', createdAt: '2026-10-22T21:33:04.880Z', isAgent: true },
    { userId: 6, emoji: '👍', createdAt: '2026-10-22T21:33:04.880Z', agentId: 'lead' },
    { userId: 6, emoji: '👍', createdAt: '2026-10-22T21:33:04.880Z', agent: { displayName: 'HT Product Lead' } },
    { userId: 7, emoji: '👍', createdAt: '2026-10-22T21:33:04.880Z' },
    { userId: 6, emoji: '👍', createdAt: '2026-10-22T21:31:00.000Z' },
    { userId: 6, emoji: '👍', createdAt: '2026-10-22T21:32:13.990Z' },
    { userId: 6, emoji: '👍' },
    { userId: 6, emoji: '👎', createdAt: '2026-10-22T21:33:04.880Z' },
  ]) {
    assert.equal((await decision(htpr7518({ reactions: [reaction] }))).state, 'failure', JSON.stringify(reaction));
  }
  assert.equal((await decision(htpr7518({ createdAt: '2026-10-22T02:00:00.000Z', editedAt: null }))).state, 'failure');
  assert.equal((await decision(htpr7518({ text: '<p>May slice A ship: AgentSidebarChatCommands?</p>' }))).state, 'failure');
  assert.equal((await decision(htpr7518({ creatorId: 6, agent: null, agent_display_name: null }))).state, 'failure');
  const later = htpr7518();
  later.comments.push(yes({ id: 299600, createdAt: '2026-10-22T21:40:00Z', text: '<p>No, change the greeting</p>' }));
  assert.equal((await decision(later)).state, 'failure');
  const unnamed = htpr7518({ text: '<p>Question: <strong>May slice A ship?</strong></p><p>Details: #comment-297898</p><p>Yes: it merges.</p>' });
  unnamed.comments[0].text = '<p>Wireframe: https://hypertask.app/wireframes/htpr-7518</p>';
  assert.equal((await decision(unnamed)).state, 'failure');
  const partlyNamed = htpr7518({ text: '<p>Question: <strong>May slice A ship with AgentSidebarChatCommands?</strong></p><p>Details: #comment-297898</p><p>Yes: it merges.</p>' });
  partlyNamed.comments[0].text = unnamed.comments[0].text;
  assert.equal((await decision(partlyNamed)).state, 'failure');
  const noNewElements = htpr7518();
  noNewElements.files = [modified];
  noNewElements.comments[0].text = unnamed.comments[0].text;
  const reused = await decision(noNewElements);
  assert.equal(reused.state, 'success');
  assert.match(reused.description, /No new component file/);
});

test('a Question thumbs up approves only an affirmative Question tied to the current wireframe', async () => {
  const linked = '<p>Question: <strong>May slice A ship with the new elements named here: AgentSidebarChatCommands,AgentConnectGreeting, TerminalSessionMirror?</strong></p><p>Wireframe: https://hypertask.app/wireframes/htpr-7518</p><p>Yes: it merges.</p>';
  assert.equal((await decision(htpr7518({ text: linked }))).state, 'success');
  for (const text of [
    '<p>Question: <strong>May slice A ship: AgentSidebarChatCommands?</strong></p><p>Yes: it merges.</p>',
    '<p>Question: <strong>Should we keep this design blocked?</strong></p><p>Details: #comment-297898</p><p>Yes: it stays blocked.</p>',
    '<p>Question: <strong>Should we not ship slice A?</strong></p><p>Details: #comment-297898</p><p>Yes: we wait.</p>',
    '<p>Question: <strong>Can this wait until next week?</strong></p><p>Details: #comment-297898</p><p>Yes: later.</p>',
    '<p>Question: <strong>May slice A ship?</strong></p><p>Details: #comment-297898</p>',
    '<p>Question: <strong>May slice A ship?</strong></p><p>Details: #comment-2978981</p><p>Yes: it merges.</p>',
    '<p>Question: <strong>May slice A ship?</strong></p><p>Wireframe: https://hypertask.app/wireframes/htpr-7000</p><p>Yes: it merges.</p>',
    '<p>Question: <strong>Should we request another review?</strong></p><p>Details: #comment-297898</p><p>Yes: request review.</p>',
    '<p>Question: <strong>Should AgentSidebarChatCommands, AgentConnectGreeting, TerminalSessionMirror get another review?</strong></p><p>Details: #comment-297898</p><p>Yes: request review.</p>',
    '<p>Question: <strong>Do you like AgentSidebarChatCommands, AgentConnectGreeting, TerminalSessionMirror?</strong></p><p>Details: #comment-297898</p><p>Yes: noted.</p>',
    '<p>Question: <strong>Should we add tests for AgentSidebarChatCommands, AgentConnectGreeting, TerminalSessionMirror?</strong></p><p>Details: #comment-297898</p><p>Yes: add tests only.</p>',
    '<p>Question: <strong>May the tests only ship with the new parts named here: AgentSidebarChatCommands, AgentConnectGreeting, TerminalSessionMirror?</strong></p><p>Details: #comment-297898</p><p>Yes: tests only.</p>',
    '<p>Question: <strong>May slice A ship with the new parts named here: AgentSidebarChatCommands?</strong></p><p>Details: #comment-297898</p><p>Yes: it merges.</p>',
    '<p>Question: <strong>May slice A ship with the new parts named here: AgentSidebarChatCommands, AgentConnectGreeting, TerminalSessionMirror? Or wait?</strong></p><p>Details: #comment-297898</p><p>Yes: it merges.</p>',
  ]) {
    assert.equal((await decision(htpr7518({ text }))).state, 'failure', text);
  }
});

const htpr7577 = ({ question = {}, earlier = {}, extra = [] } = {}) => ({
  title: 'HTPR-7577 [FEATURE] Board settings: add an existing agent to the board',
  files: [modified, slice('AddExistingAgentButton'), slice('AddExistingAgentPicker')],
  comments: [
    wireframe({ id: 298677, createdAt: '2026-10-22T10:20:01.914Z', agent: { displayName: 'Runner 5' },
      text: '<p>Wireframe ready.</p><p>https://hypertask.app/wireframes/htpr-7577</p><p>Question: <span data-type="mention">Valentin Yeo</span></p><p>New elements: AddExistingAgentButton, AddExistingAgentPicker. Add existing agents?</p>', ...earlier }),
    wireframe({ id: 299522, createdAt: '2026-10-22T21:30:28.245Z', agent: { displayName: 'HT Product Lead' },
      editedAt: '2026-10-22T21:32:11.196Z', editedBy: { userId: 6, agentId: 'lead', isAgent: true },
      text: '<p>Question: <strong>Is this wireframe right, with only board owners and admins allowed to add their own agent?</strong></p><p>Wireframe: https://hypertask.app/wireframes/htpr-7577</p><p>Yes: building starts.</p><p>No: say what to change.</p>',
      reactions: [{ userId: 6, emoji: '👍', createdAt: '2026-10-22T21:33:00.000Z' }], ...question }),
    ...extra,
  ],
});

test('HTPR-7577: a thumbs up on a newer Question with the same wireframe carries over that wireframe’s element names', async () => {
  assert.equal((await decision(htpr7577())).state, 'success');
});

test('HTPR-7577: a linkless Question needs his own yes comment; his comment then carries over the element names', async () => {
  const reply = wireframe({ id: 299543, createdAt: '2026-10-22T21:35:41.113Z', agent: { displayName: 'Runner 5' },
    text: '<p>Question: Build it so any board member can add their own agents, as in the wireframe https://hypertask.app/wireframes/htpr-7577 ?</p><p>Yes: building starts.</p>' });
  const linkless = wireframe({ id: 299550, createdAt: '2026-10-22T21:36:12.634Z', agent: { displayName: 'HT Product Lead' },
    editedAt: '2026-10-22T21:36:48.138Z', text: '<p>Question: <strong>Build it with today’s rule: any board member can add an agent they own?</strong></p><p>Yes: RUNNER 3 builds the wireframe.</p><p>No: say who.</p>',
    reactions: [{ userId: 6, emoji: '👍', createdAt: '2026-10-22T21:38:21.592Z' }] });
  const okay = yes({ id: 299551, createdAt: '2026-10-22T21:38:47.315Z', text: '<p>Okay. Either way, everybody should be able to give their agent access to a board.</p>' });
  const base = { question: { reactions: [] } };
  assert.equal((await decision(htpr7577({ ...base, extra: [reply, linkless] }))).state, 'failure');
  assert.equal((await decision(htpr7577({ ...base, extra: [reply, linkless, okay] }))).state, 'success');
});

test('element names do not carry over from another wireframe, a later edit, an agent reaction or after his pushback', async () => {
  assert.equal((await decision(htpr7577({ earlier: { text: '<p>https://hypertask.app/wireframes/htpr-7000</p><p>New elements: AddExistingAgentButton, AddExistingAgentPicker</p>' } }))).state, 'failure');
  assert.equal((await decision(htpr7577({ earlier: { editedAt: '2026-10-22T21:31:00.000Z' } }))).state, 'failure');
  assert.equal((await decision(htpr7577({ question: { reactions: [{ userId: 6, emoji: '👍', createdAt: '2026-10-22T21:33:00.000Z', isAgent: true }] } }))).state, 'failure');
  assert.equal((await decision(htpr7577({ question: { reactions: [{ userId: 6, emoji: '👍', createdAt: '2026-10-22T21:32:00.000Z' }] } }))).state, 'failure');
  const pushback = yes({ id: 299538, createdAt: '2026-10-22T21:34:21.549Z', text: '<p>Why would normal users not be able to ad their agents?</p>' });
  assert.equal((await decision(htpr7577({ extra: [pushback] }))).state, 'failure');
});

test('edited wireframe rejects thumbs up before or at the edit and accepts it after', async () => {
  const editedAt = '2026-10-10T12:02:00Z';
  for (const [createdAt, expected] of [
    ['2026-10-10T12:01:00Z', 'failure'], [editedAt, 'failure'],
    ['2026-10-10T12:03:00Z', 'success'],
  ]) {
    const comment = wireframe({ editedAt, reactions: [{ userId: 6, emoji: '👍', createdAt }] });
    assert.equal((await decision({ comments: [comment] })).state, expected);
  }
});

test('edited wireframe rejects thumbs up with missing or invalid creation time', async () => {
  for (const createdAt of [undefined, null, 'invalid']) {
    const comment = wireframe({ editedAt: '2026-10-10T12:02:00Z', reactions: [{ userId: 6, emoji: '👍', createdAt }] });
    assert.equal((await decision({ comments: [comment] })).state, 'failure');
  }
});

test('never-edited wireframe accepts thumbs up without a creation time', async () => {
  const comment = wireframe({ editedAt: null, editedBy: null, reactions: [{ userId: 6, emoji: '👍' }] });
  assert.equal((await decision({ comments: [comment] })).state, 'success');
});

test('edited wireframe prefers editedAt over the updatedAt fallback for both approval types', async () => {
  for (const updatedAt of ['2026-10-10T12:04:00Z', 'invalid']) {
    const comment = wireframe({ editedAt: '2026-10-10T12:02:00Z', updatedAt });
    const createdAt = '2026-10-10T12:03:00Z';
    assert.equal((await decision({ comments: [comment, yes({ createdAt })] })).state, 'success');
    assert.equal((await decision({ comments: [{ ...comment, reactions: [{ userId: 6, emoji: '👍', createdAt }] }] })).state, 'success');
  }
});

test('agent edit and other-user edit invalidate earlier yes-comments but allow a later yes', async () => {
  const editedAt = '2026-10-10T12:02:00Z';
  for (const editedBy of [
    { userId: 6, agentId: 'agent' }, { userId: 6, agentId: null, isAgent: true },
    { userId: 7, agentId: null }, { userId: 6, agentId: null },
  ]) {
    const comment = wireframe({ editedAt, editedBy });
    for (const [createdAt, expected] of [
      ['2026-10-10T12:01:00Z', 'failure'], [editedAt, 'failure'],
      ['2026-10-10T12:03:00Z', 'success'],
    ]) assert.equal((await decision({ comments: [comment, yes({ createdAt })] })).state, expected);
  }
});

test('only a later human Valentin yes approves a wireframe', async () => {
  assert.equal((await decision({ comments: [yes(), wireframe()] })).state, 'success');
  for (const approval of [
    yes({ createdAt: '2026-10-10T11:59:00Z' }), yes({ createdAt: '2026-10-10T12:00:00Z' }),
    yes({ createdAt: 'invalid' }), yes({ agent: { id: 'agent' } }), yes({ creatorId: 7 }), yes({ creatorId: '6' }),
  ]) assert.equal((await decision({ comments: [wireframe(), approval] })).state, 'failure');
});

test('all explicit approval prefixes work, but qualified or negative yes does not', async () => {
  for (const text of ['yes', 'yep', 'yeah', 'go', 'ok', 'okay', 'agree', 'Agree to ux though', 'approve', 'approved', 'lgtm', 'looks good', 'ship it', '👍', 'YES go']) {
    assert.equal((await decision({ comments: [wireframe(), yes({ text })] })).state, 'success', text);
  }
  for (const text of ["yes but change the header", 'yes no', 'yes not now', "yes don't ship", 'yes don’t ship', 'yes instead', 'yes change it', 'no, change X', 'agree but change X', 'agree no', 'agree not yet', 'agree instead', 'yesterday', 'good', 'okayish', 'maybe yes']) {
    assert.equal((await decision({ comments: [wireframe(), yes({ text })] })).state, 'failure', text);
  }
});

test('"agreed" is a yes word; HTPR-7263’s "Agreed but ... new ticket" still needs his thumbs up', async () => {
  const agreed = '<html><head></head><body><p>Agreed but why is the blue border misaligned we have the same problem on desktop pls create a new ticket for the misalginge dborder on deksotp mobile and fix that too. The blue border when the checkbox is present and ticketd<a target="_blank" rel="noopener noreferrer nofollow" href="https://screencast2.com/a8liU.png">https://screencast2.com/a8liU.png</a><br><img src="https://screencast2.com/a8liU.png?raw" media-type="img" width="181" height="320" dataalign="left" loading="lazy" style="height: 320px; width: 181px;">the left border is off</p></body></html>';
  for (const text of ['agreed', 'Agreed.', 'Agreed, ship it', 'Yes, the fix looks good']) {
    assert.equal((await decision({ comments: [wireframe(), yes({ text })] })).state, 'success', text);
  }
  for (const text of [agreed, 'no', 'not like this', 'change X first', 'agreed but change X', 'agreed not yet', 'agreeable',
    'Yes but create a new ticket for the icon and fix the header on this wireframe',
    'Yes but change the header on this wireframe; create a new ticket for the icon']) {
    assert.equal((await decision({ comments: [wireframe(), yes({ text })] })).state, 'failure', text);
  }
});

test('claude.ai artifact wireframes accept only Valentin’s own human agreement', async () => {
  const artifact = wireframe({ text: '<p>https://claude.ai/artifact/YVeR2xUWw7KcWFNH8YtEbf</p><p>New elements: ExamplePanel</p>', agent: { displayName: 'Runner 8' } });
  assert.equal((await decision({ comments: [artifact, yes({ text: 'Agree to ux though' })] })).state, 'success');
  for (const marker of ['agent', 'agent_display_name', 'agentId', 'isAgent']) {
    assert.equal((await decision({ comments: [artifact, yes({ text: 'Agree to ux though', [marker]: 'Runner 8' })] })).state, 'failure');
  }
  assert.equal((await decision({ comments: [artifact, yes({ text: 'Valentin said: yes', agent: { displayName: 'Runner 8' } })] })).state, 'failure');
  assert.equal((await decision({ comments: [artifact, yes({ text: 'no, change X' })] })).state, 'failure');
});

test('the parent approves only when the child has no sign-off thread, a child rejection still refuses, and threads never mix', async () => {
  const parentComments = [wireframe(), yes()];
  assert.equal((await decision({ parentComments })).state, 'success');
  assert.equal((await decision({ comments: [wireframe(), yes()], parentComments: [wireframe(), yes({ text: 'no, change X' })] })).state, 'success');
  assert.equal((await decision({ comments: [wireframe(), yes({ text: 'no, change X' })], parentComments })).state, 'failure');
  for (const comments of [[wireframe()], [yes()]]) {
    assert.equal((await decision({ comments, parentComments: comments[0].id === 1 ? [yes()] : [wireframe()] })).state, 'failure');
  }
  assert.equal((await decision({ parentComments: [wireframe(), yes({ agent: { displayName: 'Runner 8' } })] })).state, 'failure');
  assert.equal((await decision({ files: [added], parentComments: [wireframe({ text: '<p>https://hypertask.app/wireframes/decision-inbox</p>' }), yes()] })).state, 'failure');
  assert.equal((await decision({ files: [added], parentComments: [wireframe(), yes({ text: 'agree New elements: ExamplePanel' })] })).state, 'success');
  assert.equal((await decision({ comments: [wireframe({ id: 9, createdAt: '2026-10-11T12:00:00Z' })], parentComments })).state, 'success');
  const otherDesign = wireframe({ id: 9, text: '<p>https://claude.ai/artifact/OtherDesign1</p>', createdAt: '2026-10-11T12:00:00Z' });
  assert.equal((await decision({ comments: [otherDesign], parentComments })).state, 'failure');
  const historicalOther = wireframe({ id: 7, text: '<p>https://claude.ai/artifact/OtherDesign1</p>', createdAt: '2026-10-09T12:00:00Z' });
  assert.equal((await decision({ comments: [otherDesign], parentComments: [historicalOther, wireframe(), yes()] })).state, 'failure');
  const editedChild = wireframe({ id: 9, createdAt: '2026-10-11T12:00:00Z', editedAt: '2026-10-12T12:00:00Z', reactions: [{ userId: 6, emoji: '👍', createdAt: '2026-10-11T13:00:00Z' }] });
  assert.equal((await decision({ comments: [editedChild], parentComments })).state, 'failure');
});

test('mentions are removed and HTML and basic entities are decoded before matching', async () => {
  assert.equal((await decision({ comments: [wireframe(), yes({ text: '<span data-label="name-6" data-type="mention">Valentin Yeo</span><p>yes&nbsp;go</p>' })] })).state, 'success');
  assert.equal((await decision({ comments: [wireframe(), yes({ text: '<span data-type="mention">yes go</span><p>Maybe</p>' })] })).state, 'failure');
  assert.equal((await decision({ comments: [wireframe(), yes({ text: '<p>&#121;&#x65;s go</p>' })] })).state, 'success');
  assert.equal((await decision({ comments: [wireframe(), yes({ text: '<p>yes don&#39;t ship</p>' })] })).state, 'failure');
});

test('new elements need normalized names in approved wireframes or approving human comments', async () => {
  const approved = wireframe({ text: 'https://hypertask.app/explorations/decision_inbox New elements: Example Panel', reactions: [{ userId: 6, emoji: '👍' }] });
  assert.equal((await decision({ files: [added], comments: [approved] })).state, 'success');
  assert.equal((await decision({ files: [added], comments: [wireframe({ text: '<p>https://hypertask.app/wireframes/decision-inbox</p>', reactions: [{ userId: 6, emoji: '👍' }] })] })).state, 'failure');
  const inQuestion = wireframe({ text: '<p>https://hypertask.app/wireframes/htpr-7072</p><p>Question: build it? New elements: ExamplePanel.</p><p>Next: wait</p>', reactions: [{ userId: 6, emoji: '👍' }] });
  assert.equal((await decision({ files: [added], comments: [inQuestion] })).state, 'success');
  assert.equal((await decision({ files: [added], comments: [wireframe(), yes({ text: 'yes\nNew elements: Example_Panel' })] })).state, 'success');
  assert.equal((await decision({ files: [added], comments: [wireframe({ text: `${approved.text}<span data-type="mention">ExamplePanel</span>`, reactions: [{ userId: 6, emoji: '👍' }] })] })).state, 'success');
  assert.equal((await decision({ files: [added], comments: [wireframe({ text: 'https://hypertask.app/wireframes/a <span data-type="mention">ExamplePanel</span>', reactions: [{ userId: 6, emoji: '👍' }] })] })).state, 'failure');
  assert.equal((await decision({ title: 'HTPR-1 [BUGFIX] Repair', files: [added], comments: [yes({ text: 'approved\nNew elements: ExamplePanel' })] })).state, 'success');
  assert.equal((await decision({ title: 'HTPR-1 [BUGFIX] Repair', files: [added], comments: [yes({ text: 'approved\nNew elements: ExamplePanel', agent: { id: 'agent' } })] })).state, 'failure');
  assert.equal((await decision({ files: [added], comments: [wireframe({ text: approved.text }), yes({ text: 'maybe ExamplePanel' })] })).state, 'failure');
});

test('copied components need names; renamed components, CSS and app files need no names and no wireframe', async () => {
  assert.equal((await decision({ title: 'HTPR-1 [BUGFIX] Repair', files: [{ ...added, status: 'copied' }] })).state, 'failure');
  for (const file of [{ ...added, status: 'renamed' }, { ...added, filename: 'src/components/Panel.css' }, { ...added, filename: 'src/app/inbox/page.tsx' }]) {
    assert.equal((await decision({ files: [file], comments: [wireframe(), yes()] })).state, 'success');
    assert.match((await decision({ files: [file] })).description, /No new component file/);
  }
  const result = await decision({ files: Array.from({ length: 8 }, (_, i) => ({ ...added, filename: `src/components/VeryLongComponentName${i}.jsx` })) });
  assert.equal(result.state, 'failure');
  assert.match(result.details[1], /VeryLongComponentName7/);
});

test('API, tests, stories and unrelated paths are not visible UI', async () => {
  for (const filename of ['src/app/api/inbox/route.tsx', 'src/components/x/Foo.test.tsx', 'src/components/x/Foo.spec.jsx', 'src/components/x/Foo.stories.tsx', 'src/app/__tests__/page.tsx', 'src/lib/Foo.tsx', 'src/components/x/Foo.ts', 'src/application/Foo.tsx']) {
    assert.deepEqual(await decision({ files: [{ filename, status: 'added' }] }), { state: 'success', description: 'No visible UI change', details: [] });
  }
  assert.equal((await decision({ files: [{ ...added, status: 'removed' }] })).state, 'success');
  assert.equal((await decision({ files: [{ ...added, status: 'removed' }, added] })).state, 'failure');
  assert.equal((await decision({ author: 'dependabot[bot]', title: 'Bump package', files: [added] })).state, 'success');
});

test('ticket title is strict; unknown project links fall back to the workflow run', async () => {
  for (const invalid of ['No ticket', 'HTPR-1 [FEATURE]', 'HTPR-1 [FEATURE]  UI', 'HTPR-1[FEATURE] UI', 'prefix HTPR-1 [FEATURE] UI']) {
    assert.match((await decision({ title: invalid })).description, /Title names no ticket/);
  }
  const { ticketUrl } = await gate;
  assert.equal(ticketUrl(title, 'run'), 'https://app.hypertask.ai/detail/project-15/7072');
  assert.equal(ticketUrl('YPER4-254 [INFRA] Gate', 'run'), 'https://app.hypertask.ai/detail/project-4060/254');
  assert.equal(ticketUrl('HYFA-1 [FEATURE] UI', 'run'), 'run');
  assert.equal(ticketUrl('unknown', 'run'), 'run');
});

test('lookalike links and unapproved wireframes do not count', async () => {
  for (const text of ['https://example.com/wireframes/a', 'https://hypertask.app.evil/wireframes/a', 'http://hypertask.app/wireframes/a', 'https://hypertask.app/wireframes/', 'https://claude.ai.evil/artifact/a', 'http://claude.ai/artifact/a', 'https://claude.ai/artifact/', 'https://claude.ai/artifacts/a']) {
    assert.equal((await decision({ comments: [wireframe({ text }), yes()] })).state, 'failure');
  }
});

function response(data, status = 200, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers),
    text: async () => JSON.stringify(data), json: async () => data };
}
const env = { GH_TOKEN: 'github-fixture', MCP_TOKEN: 'hypertask-fixture', REPO: 'fixture/repo', RUN_URL: 'https://github.com/fixture/repo/actions/runs/1' };
const pr = (number = 1, overrides = {}) => ({ number, title: 'HTPR-1 [BUGFIX] Repair', user: { login: 'builder' }, state: 'open', base: { ref: 'production', sha: 'b'.repeat(40) }, head: { sha: number.toString(16).padStart(40, '1') }, ...overrides });
function apiFixture({ prs = [pr()], files = [modified], statuses = [], prError, currentPr } = {}) {
  const calls = [];
  const reads = new Map();
  const github = async (endpoint, options = {}) => {
    calls.push({ endpoint, ...options });
    if (options.method === 'POST') return {};
    if (/\/pulls\?/.test(endpoint)) {
      const page = Number(new URL(`https://fixture/${endpoint}`).searchParams.get('page'));
      return prs.slice((page - 1) * 100, page * 100);
    }
    if (/\/files\?/.test(endpoint)) return files;
    if (/\/statuses\?/.test(endpoint)) return statuses;
    const number = Number(endpoint.split('/').at(-1));
    if (number === prError) throw new Error('fixture read error');
    reads.set(number, (reads.get(number) ?? 0) + 1);
    return currentPr && reads.get(number) > 1 ? currentPr : prs.find((item) => item.number === number);
  };
  return { github, calls };
}
const ticketResponse = (url, parent = null) => response({ success: true, tasks: [{
  ticketNumber: new URL(String(url)).searchParams.get('ticket_number'),
  ...(parent ? { parent_id: 99123, parent_task: { id: 99123, ticketNumber: parent } } : {}),
}] });
const commentsFetch = async (url) => new URL(String(url)).pathname === '/api/mcp/tasks'
  ? ticketResponse(url) : response({ success: true, comments: [], nextCursor: null });

test('PR 1771 reads the API parent of HTPR-7549 and accepts Valentin’s artifact agreement on HTPR-7511', async () => {
  const { run } = await gate;
  const fixture = apiFixture({ prs: [pr(1771, { title: 'HTPR-7549 [FEATURE] UI' })], files: [modified, added] });
  const requests = [];
  const output = [];
  const fetchImpl = async (url, options) => {
    requests.push(String(url));
    assert.equal(options.headers.Authorization, 'Bearer hypertask-fixture');
    assert.equal(options.method, undefined);
    const parsed = new URL(String(url));
    if (parsed.pathname === '/api/mcp/tasks') return ticketResponse(url, 'HTPR-7511');
    assert.equal(parsed.pathname, '/api/mcp/comments');
    return response({ comments: parsed.searchParams.get('ticket_number') === 'HTPR-7511'
      ? [wireframe({ text: '<p>https://claude.ai/artifact/YVeR2xUWw7KcWFNH8YtEbf</p><p>New elements: ExamplePanel</p>', agent: { displayName: 'Runner 8' } }), yes({ text: 'Agree to ux though' })] : [] });
  };
  assert.equal(await run(['--pr', '1771'], { env, github: fixture.github, fetchImpl, log: (line) => output.push(JSON.parse(line)) }), 0);
  assert.equal(output[0].state, 'success');
  assert.deepEqual(requests, [
    'https://app.hypertask.ai/api/mcp/comments?ticket_number=HTPR-7549&limit=100',
    'https://app.hypertask.ai/api/mcp/tasks?ticket_number=HTPR-7549',
    'https://app.hypertask.ai/api/mcp/comments?ticket_number=HTPR-7511&limit=100',
  ]);
  assert.ok(fixture.calls.every((call) => call.method !== 'POST'));
});

test('approved child needs no parent read, and missing or inaccessible parent metadata fails closed', async () => {
  const { run } = await gate;
  const fixture = () => apiFixture({ prs: [pr(1, { title })], files: [added] });
  assert.equal(await run(['--pr', '1'], { env, github: fixture().github, fetchImpl: async (url) => {
    assert.equal(new URL(String(url)).pathname, '/api/mcp/comments');
    return response({ comments: [wireframe(), yes()] });
  }, log: () => {} }), 0);
  for (const data of [
    { success: false }, { tasks: [] }, { tasks: [{ ticketNumber: 'HTPR-999' }] },
    { tasks: [{ ticketNumber: 'HTPR-7072', parent_id: 99123 }] },
    { tasks: [{ ticketNumber: 'HTPR-7072', parent_task: { ticketNumber: 'HTPR-7072' } }] },
    { tasks: [{ ticketNumber: 'HTPR-7072', parent_task: { ticketNumber: 'unrelated' } }] },
  ]) {
    await assert.rejects(run(['--pr', '1'], { env, github: fixture().github, fetchImpl: async (url) =>
      new URL(String(url)).pathname === '/api/mcp/tasks' ? response(data) : response({ comments: [] }), log: () => {} }), /valid ticket|valid parent ticket number/);
  }
  await assert.rejects(run(['--pr', '1'], { env, github: fixture().github, fetchImpl: async (url) =>
    new URL(String(url)).pathname === '/api/mcp/tasks' ? response({}, 403) : response({ comments: [] }), log: () => {} }), /HTTP 403/);
});

test('parent comments are paginated and shared between PRs without reading grandparents', async () => {
  const { run } = await gate;
  const prs = [pr(1, { title }), pr(2, { title: 'HTPR-7073 [FEATURE] UI' })];
  const fixture = apiFixture({ prs, files: [modified, added] });
  const requests = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(String(url));
    const ticket = parsed.searchParams.get('ticket_number');
    requests.push(`${parsed.pathname}:${ticket}:${parsed.searchParams.get('cursor') || ''}`);
    if (parsed.pathname === '/api/mcp/tasks') {
      assert.notEqual(ticket, 'HTPR-7511');
      return ticketResponse(url, 'HTPR-7511');
    }
    if (ticket !== 'HTPR-7511') return response({ comments: [] });
    return parsed.searchParams.has('cursor') ? response({ comments: [yes()] })
      : response({ comments: [wireframe()], nextCursor: 'next' });
  };
  assert.equal(await run(['--reconcile'], { env, github: fixture.github, fetchImpl, log: () => {} }), 0);
  assert.equal(requests.filter((request) => request.startsWith('/api/mcp/comments:HTPR-7511:')).length, 2);
  assert.deepEqual(fixture.calls.filter((call) => call.method === 'POST').map((call) => call.body.state), ['success', 'success']);
});

test('Hypertask auth, query and cursor pagination match the read API', async () => {
  const requests = [];
  const result = await (await gate).readComments('HTPR-1', { env, fetchImpl: async (url, options) => {
    requests.push({ url: String(url), options });
    return response({ success: true, comments: [wireframe()], nextCursor: requests.length === 1 ? '123' : null });
  } });
  assert.equal(result.length, 2);
  assert.equal(requests[0].url, 'https://app.hypertask.ai/api/mcp/comments?ticket_number=HTPR-1&limit=100');
  assert.equal(new URL(requests[1].url).searchParams.get('cursor'), '123');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer hypertask-fixture');
  assert.equal(requests[0].options.method, undefined);
});

test('Hypertask read failures, missing auth, invalid data and repeated cursors fail closed', async () => {
  const { readComments } = await gate;
  await assert.rejects(readComments('HTPR-1', { env: {}, fetchImpl: () => assert.fail('must not fetch') }), /empty/);
  for (const data of [{ success: false, comments: [] }, {}, { comments: [{ text: null }] }, { comments: [], nextCursor: {} }]) {
    await assert.rejects(readComments('HTPR-1', { env, fetchImpl: async () => response(data) }));
  }
  await assert.rejects(readComments('HTPR-1', { env, fetchImpl: async () => response({}, 403) }), /HTTP 403/);
  await assert.rejects(readComments('HTPR-1', { env, fetchImpl: async () => response({ comments: [], nextCursor: '123' }) }), /repeated cursor/);
});

test('GitHub uses bearer REST or gh api fallback without executing PR code', async () => {
  const { createGithub } = await gate;
  const calls = [];
  const github = createGithub({ env, fetchImpl: async (...args) => { calls.push(args); return response({ ok: true }); } });
  await github('repos/fixture/repo/pulls/1');
  await github('repos/fixture/repo/statuses/sha', { method: 'POST', body: { state: 'success' } });
  assert.equal(calls[0][0], 'https://api.github.com/repos/fixture/repo/pulls/1');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer github-fixture');
  assert.equal(JSON.parse(calls[1][1].body).state, 'success');
  const fallback = createGithub({ env: {}, exec: (command, args, options) => {
    assert.equal(command, 'gh');
    assert.deepEqual(args, ['api', '--include', '--method', 'POST', 'repos/fixture/repo/statuses/sha', '--input', '-']);
    assert.equal(options.input, '{"state":"success"}');
    return '{}';
  } });
  await fallback('repos/fixture/repo/statuses/sha', { method: 'POST', body: { state: 'success' } });
  await assert.rejects(createGithub({ env, fetchImpl: async () => response({}, 401) })('repos/fixture/repo/pulls/1'), /HTTP 401/);
});

test('YPER4-881: GitHub reads use GH_READ_TOKEN and fall back once; writes keep GH_TOKEN', async () => {
  const { createGithub } = await gate;
  const auth = [];
  const statuses = [401, 200, 200];
  const github = createGithub({ env: { ...env, GH_READ_TOKEN: 'ci-app' }, log: () => {}, fetchImpl: async (_, init) => {
    auth.push(init.headers.Authorization);
    const status = statuses.shift();
    return response({ ok: true }, status);
  } });
  await github('repos/fixture/repo/pulls/1');
  await github('repos/fixture/repo/statuses/sha', { method: 'POST', body: { state: 'success' } });
  assert.deepEqual(auth, ['Bearer ci-app', 'Bearer github-fixture', 'Bearer github-fixture']);
});

test('GitHub GET retries transient HTTP failures then succeeds', async () => {
  const { createGithub } = await gate;
  for (const status of [502, 429]) {
    let calls = 0;
    const waits = [];
    const github = createGithub({ env, sleep: async (ms) => waits.push(ms), fetchImpl: async () => {
      calls++;
      return calls === 1 ? response({}, status) : response({ ok: true });
    } });
    assert.deepEqual(await github('repos/fixture/repo/pulls/1'), { ok: true });
    assert.equal(calls, 2);
    assert.deepEqual(waits, [status === 429 ? 60000 : 1000]);
  }
});

test('a post-verdict GET (noWait) skips on a rate limit instead of waiting, on both transports', async () => {
  const { createGithub } = await gate;
  let calls = 0;
  const github = createGithub({ env, sleep: () => assert.fail('post-verdict reads must not sleep'), fetchImpl: async () => {
    calls++;
    return response({ message: 'rate limit' }, 429, { 'retry-after': '5' });
  } });
  await assert.rejects(github('repos/fixture/repo/pulls/1', { noWait: true }), (error) => error.rateLimited);
  assert.equal(calls, 1);
  let execCalls = 0;
  const fallback = createGithub({ env: {}, sleep: () => assert.fail('post-verdict reads must not sleep'), exec: () => {
    execCalls++;
    const error = new Error('HTTP 429');
    error.status = 1;
    error.stdout = 'HTTP/2.0 429 Too Many Requests\r\nRetry-After: 5\r\n\r\n{"message":"rate limit"}';
    error.stderr = 'gh: HTTP 429';
    throw error;
  } });
  await assert.rejects(fallback('repos/fixture/repo/pulls/1', { noWait: true }), (error) => error.rateLimited);
  assert.equal(execCalls, 1);
});

test('GitHub GET retries a network failure then succeeds', async () => {
  const { createGithub } = await gate;
  let calls = 0;
  const github = createGithub({ env, sleep: async () => {}, fetchImpl: async () => {
    calls++;
    if (calls === 1) throw new Error('network timeout');
    return response({ ok: true });
  } });
  assert.deepEqual(await github('repos/fixture/repo/pulls/1'), { ok: true });
  assert.equal(calls, 2);
});

test('GitHub GET does not retry HTTP 404', async () => {
  const { createGithub } = await gate;
  let calls = 0;
  const github = createGithub({ env, sleep: () => assert.fail('must not wait'), fetchImpl: async () => {
    calls++;
    return response({}, 404);
  } });
  await assert.rejects(github('repos/fixture/repo/pulls/1'), /HTTP 404/);
  assert.equal(calls, 1);
});

test('GitHub POST does not retry HTTP 502', async () => {
  const { createGithub } = await gate;
  let calls = 0;
  const github = createGithub({ env, sleep: () => assert.fail('must not wait'), fetchImpl: async () => {
    calls++;
    return response({}, 502);
  } });
  await assert.rejects(github('repos/fixture/repo/statuses/sha', { method: 'POST', body: { state: 'success' } }), /HTTP 502/);
  assert.equal(calls, 1);
});

test('GitHub GET rejects after three HTTP 503 failures', async () => {
  const { createGithub } = await gate;
  let calls = 0;
  const waits = [];
  const github = createGithub({ env, sleep: async (ms) => waits.push(ms), fetchImpl: async () => {
    calls++;
    return response({}, 503);
  } });
  await assert.rejects(github('repos/fixture/repo/pulls/1'), /HTTP 503/);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1000, 3000]);
});

test('reconcile logs a sanitized HTTP reason after persistent GitHub GET failure', async () => {
  const { createGithub, run } = await gate;
  const fixture = apiFixture({ prs: [pr(1), pr(2)] });
  const output = [];
  let failedReads = 0;
  const github = createGithub({ env, sleep: async () => {}, fetchImpl: async (url, options) => {
    const endpoint = url.replace('https://api.github.com/', '');
    if (endpoint === 'repos/fixture/repo/pulls/1') {
      failedReads++;
      return response({ message: 'sensitive response body' }, 502);
    }
    return response(await fixture.github(endpoint, options));
  } });
  assert.equal(await run(['--reconcile'], { env, github, fetchImpl: commentsFetch, log: (line) => output.push(JSON.parse(line)) }), 2);
  assert.equal(failedReads, 3);
  assert.deepEqual(output[0], {
    pr: 1, state: 'error', description: 'Could not read or publish UX signoff status; left untouched', reason: 'GitHub API returned HTTP 502',
  });
  assert.deepEqual(fixture.calls.filter((call) => call.method === 'POST').map((call) => call.endpoint), [`repos/fixture/repo/statuses/${pr(2).head.sha}`]);
});

test('reconcile error reasons allow only safe GitHub messages and missing head SHA', async () => {
  const { run } = await gate;
  for (const [message, reason] of [
    ['GitHub API returned no list', 'GitHub API returned no list'],
    ['No PR head SHA to publish', 'No PR head SHA to publish'],
    ['GitHub API returned HTTP 502: sensitive response body', 'unexpected error'],
    [`network error with ${env.GH_TOKEN}`, 'unexpected error'],
  ]) {
    const fixture = apiFixture();
    const output = [];
    const github = (endpoint, options) => {
      if (endpoint === 'repos/fixture/repo/pulls/1') throw new Error(message);
      return fixture.github(endpoint, options);
    };
    assert.equal(await run(['--reconcile'], { env, github, fetchImpl: commentsFetch, log: (line) => output.push(JSON.parse(line)) }), 2);
    assert.equal(output[0].reason, reason);
    assert.ok(fixture.calls.every((call) => call.method !== 'POST'));
  }
});

test('read-only CLI prints success or failure and never posts statuses', async () => {
  const { run } = await gate;
  for (const [title, files, expected] of [['HTPR-1 [BUGFIX] Repair', [modified], 0], ['HTPR-1 [FEATURE] UI', [modified, added], 1]]) {
    const fixture = apiFixture({ prs: [pr(1, { title })], files });
    const output = [];
    assert.equal(await run(['--pr', '1'], { env, github: fixture.github, fetchImpl: commentsFetch, log: (line) => output.push(JSON.parse(line)) }), expected);
    assert.equal(output[0].state, expected ? 'failure' : 'success');
    assert.ok(fixture.calls.every((call) => call.method !== 'POST'));
  }
  for (const args of [[], ['--pr'], ['--pr', '0'], ['--pr', 'bad'], ['--unknown'], ['--pr', '1', '--pr', '2']]) {
    await assert.rejects(run(args, { env, github: () => assert.fail('must not fetch') }), /Usage|requires/);
  }
});

test('PR files and open PR lists are paginated', async () => {
  const { run } = await gate;
  const calls = [];
  const github = async (endpoint) => {
    calls.push(endpoint);
    if (/\/pulls\?/.test(endpoint)) return endpoint.endsWith('page=1') ? Array.from({ length: 100 }, (_, i) => pr(i + 1)) : [pr(101)];
    if (/\/files\?/.test(endpoint)) return endpoint.endsWith('page=1') ? Array(100).fill(modified) : [modified];
    if (/\/statuses\?/.test(endpoint)) return [{ context: 'ux-signoff', state: 'success', description: 'Wireframe exempt; new elements approved' }];
    return pr(Number(endpoint.split('/').at(-1)));
  };
  assert.equal(await run(['--reconcile'], { env, github, fetchImpl: commentsFetch, log: () => {} }), 0);
  assert.ok(calls.some((endpoint) => /\/pulls\?.*page=2$/.test(endpoint)));
  assert.ok(calls.some((endpoint) => /\/files\?.*page=2$/.test(endpoint)));
  assert.ok(calls.includes('repos/fixture/repo/pulls/101'));
});

test('reconcile publishes failures on head SHAs with ticket targets and skips identical newest statuses', async () => {
  const { run } = await gate;
  const fixture = apiFixture({ prs: [pr(1, { title })], files: [added] });
  assert.equal(await run(['--reconcile', '--pr', '1'], { env, github: fixture.github, fetchImpl: commentsFetch, log: () => {} }), 0);
  const posted = fixture.calls.find((call) => call.method === 'POST');
  assert.equal(posted.endpoint, `repos/fixture/repo/statuses/${'1'.repeat(40)}`);
  assert.equal(posted.body.context, 'ux-signoff');
  assert.equal(posted.body.state, 'failure');
  assert.equal(posted.body.target_url, 'https://app.hypertask.ai/detail/project-15/7072');
  const unchanged = apiFixture({ prs: [pr(1, { title })], files: [added], statuses: [{ context: 'other', state: 'success' }, posted.body, { ...posted.body, state: 'success' }] });
  assert.equal(await run(['--reconcile'], { env, github: unchanged.github, fetchImpl: commentsFetch, log: () => {} }), 0);
  assert.ok(unchanged.calls.every((call) => call.method !== 'POST'));
  const changed = apiFixture({ prs: [pr(1, { title })], files: [added], statuses: [{ ...posted.body, state: 'success' }, posted.body] });
  await run(['--reconcile'], { env, github: changed.github, fetchImpl: commentsFetch, log: () => {} });
  assert.ok(changed.calls.some((call) => call.method === 'POST'));
});

test('missing secret only affects gated PRs and metadata errors leave heads untouched', async () => {
  const { run } = await gate;
  const fixture = apiFixture({ prs: [pr(1), pr(2)], prError: 1 });
  assert.equal(await run(['--reconcile'], { env, github: fixture.github, fetchImpl: commentsFetch, log: () => {} }), 2);
  assert.deepEqual(fixture.calls.filter((call) => call.method === 'POST').map((call) => call.body.state), ['success']);
  const missing = apiFixture({ prs: [pr(1, { title })], files: [added] });
  assert.equal(await run(['--reconcile', '--pr', '1'], { env: { ...env, MCP_TOKEN: '' }, github: missing.github, fetchImpl: () => assert.fail('must not fetch'), log: () => {} }), 2);
  const posted = missing.calls.find((call) => call.method === 'POST');
  assert.equal(posted.body.state, 'error');
  assert.match(posted.body.description, /HYPERTASK_MCP_TOKEN.*configure/);
  const readFailure = apiFixture({ prs: [pr(1, { title })], files: [added] });
  assert.equal(await run(['--reconcile'], { env, github: readFailure.github, fetchImpl: async () => response({}, 503), log: () => {} }), 0);
  assert.deepEqual(readFailure.calls.filter((call) => call.method === 'POST').map((call) => call.body.state), ['pending']);
});

test('single-PR reconciliation never publishes an unvalidated head on metadata read error', async () => {
  const { run } = await gate;
  const fixture = apiFixture({ prs: [pr(1), pr(2)], prError: 1 });
  assert.equal(await run(['--reconcile', '--pr', '1'], { env, github: fixture.github, fetchImpl: commentsFetch, log: () => {} }), 2);
  const posts = fixture.calls.filter((call) => call.method === 'POST');
  assert.equal(posts.length, 0);
  assert.ok(!fixture.calls.some((call) => call.endpoint === 'repos/fixture/repo/pulls/2'));
});

test('incomplete files, status publication errors and changed PR metadata do not pass', async () => {
  const { run } = await gate;
  const incomplete = apiFixture({ prs: [pr(1, { changed_files: 2 })] });
  assert.equal(await run(['--reconcile'], { env, github: incomplete.github, fetchImpl: commentsFetch, log: () => {} }), 2);
  const race = apiFixture({ files: [modified, added], currentPr: pr(1, { title: 'HTPR-1 [FEATURE] UI' }) });
  const namedByYesOnly = async (url) => new URL(String(url)).pathname === '/api/mcp/tasks'
    ? ticketResponse(url) : response({ comments: [yes({ text: 'yes\nNew elements: ExamplePanel' })] });
  assert.equal(await run(['--reconcile'], { env, github: race.github, fetchImpl: namedByYesOnly, log: () => {} }), 0);
  assert.equal(race.calls.find((call) => call.method === 'POST').body.state, 'failure');
  const failed = apiFixture();
  assert.equal(await run(['--reconcile'], { env, github: (endpoint, options) => {
    if (options?.method === 'POST') throw new Error('write failed');
    return failed.github(endpoint, options);
  }, fetchImpl: commentsFetch, log: () => {} }), 2);
  for (const changed of [pr(1, { state: 'closed' }), pr(1, { base: { ref: 'main' } })]) {
    const skip = apiFixture({ prs: [changed] });
    assert.equal(await run(['--reconcile', '--pr', '1'], { env, github: skip.github, fetchImpl: commentsFetch, log: () => {} }), 0);
    assert.ok(skip.calls.every((call) => call.method !== 'POST'));
  }
});

test('item 1: all agent attribution markers reject comments and reactions', async () => {
  for (const marker of ['agent', 'agent_display_name', 'agentId', 'isAgent']) {
    for (const value of [{ id: 'runner' }, 'Private agent', true, false, 0, '']) {
      assert.equal((await decision({ comments: [wireframe(), yes({ [marker]: value })] })).state, 'failure', marker);
      assert.equal((await decision({ comments: [wireframe({ reactions: [{ userId: 6, emoji: '👍', [marker]: value }] })] })).state, 'failure', marker);
    }
    assert.equal((await decision({ comments: [wireframe(), yes({ [marker]: null })] })).state, 'success');
  }
});

test('item 2: latest wireframe and newest subsequent human verdict decide', async () => {
  const old = wireframe({ reactions: [{ userId: 6, emoji: '👍' }] });
  const latest = wireframe({ id: 3, text: 'https://hypertask.app/wireframes/replacement\nNew elements: ExamplePanel', createdAt: '2026-10-10T12:02:00Z' });
  assert.equal((await decision({ comments: [latest, yes(), old] })).state, 'failure');
  const approved = { ...latest, reactions: [{ userId: 6, emoji: '✅' }] };
  assert.equal((await decision({ comments: [old, approved] })).state, 'success');
  const later = (text, extra = {}) => yes({ id: 4, text, createdAt: '2026-10-10T12:03:00Z', ...extra });
  for (const text of ['no', 'nope', 'not this', 'reject this', "don't ship", 'yes but change it', 'use this instead']) {
    assert.equal((await decision({ comments: [later(text), approved, yes()] })).state, 'failure', text);
  }
  assert.equal((await decision({ comments: [approved, later('no'), later('yes', { id: 5, createdAt: '2026-10-10T12:04:00Z' })] })).state, 'success');
  assert.equal((await decision({ comments: [approved, later('no'), later('A neutral follow-up', { createdAt: '2026-10-10T12:05:00Z' })] })).state, 'failure');
  assert.equal((await decision({ comments: [approved, later('no', { agent_display_name: 'Runner' })] })).state, 'success');
  assert.equal((await decision({ comments: [yes()] })).state, 'failure');
});

test('item 3: edits require a timestamped later reaction or a separate later human yes', async () => {
  const edit = '2026-10-10T12:02:00Z';
  for (const field of ['updatedAt', 'editedAt']) {
    const edited = wireframe({ [field]: edit, reactions: [{ userId: 6, emoji: '👍' }] });
    assert.equal((await decision({ comments: [edited, yes()] })).state, 'failure');
    for (const createdAt of [undefined, 'invalid', '2026-10-10T12:01:00Z', edit]) {
      assert.equal((await decision({ comments: [{ ...edited, reactions: [{ userId: 6, emoji: '👍', createdAt }] }] })).state, 'failure');
    }
    assert.equal((await decision({ comments: [{ ...edited, reactions: [{ userId: 6, emoji: '👍', createdAt: '2026-10-10T12:03:00Z' }] }] })).state, 'success');
    assert.equal((await decision({ comments: [edited, yes({ createdAt: '2026-10-10T12:03:00Z' })] })).state, 'success');
    assert.equal((await decision({ comments: [edited, yes({ createdAt: edit })] })).state, 'failure');
    assert.equal((await decision({ comments: [{ ...edited, [field]: 'invalid' }, yes({ createdAt: '2026-10-10T12:03:00Z' })] })).state, 'failure');
  }
  const both = wireframe({ updatedAt: edit, editedAt: '2026-10-10T12:04:00Z' });
  assert.equal((await decision({ comments: [both, yes({ createdAt: '2026-10-10T12:03:00Z' })] })).state, 'failure');
  assert.equal((await decision({ comments: [wireframe({ reactions: [{ userId: 6, emoji: '👍' }] })] })).state, 'success');
});

test('item 4: exemptions precede ticket reads and secret checks', async () => {
  const { run } = await gate;
  for (const [prTitle, files] of [
    [title, [{ filename: 'docs/guide.md', status: 'modified' }]],
    ['HTPR-1 [BUGFIX] Repair', [modified]],
    ['HTPR-1 [BUGFIX] Remove screen', [{ ...modified, status: 'removed' }]],
    ['YPER4-254 [INFRA] Refactor', [modified]],
    [title, [modified]],
  ]) {
    for (const MCP_TOKEN of ['', env.MCP_TOKEN]) {
      const fixture = apiFixture({ prs: [pr(1, { title: prTitle })], files });
      assert.equal(await run(['--reconcile'], { env: { ...env, MCP_TOKEN }, github: fixture.github, fetchImpl: () => assert.fail('exempt PR must not read Hypertask'), log: () => {} }), 0);
      assert.equal(fixture.calls.find((call) => call.method === 'POST').body.state, 'success');
    }
  }
  for (const prTitle of [title, 'HTPR-1 [BUGFIX] Repair', 'YPER4-254 [INFRA] New element']) {
    const fixture = apiFixture({ prs: [pr(1, { title: prTitle })], files: [added] });
    assert.equal(await run(['--reconcile'], { env: { ...env, MCP_TOKEN: '' }, github: fixture.github, fetchImpl: () => assert.fail('missing token'), log: () => {} }), 2);
    assert.equal(fixture.calls.find((call) => call.method === 'POST').body.state, 'error');
  }
});

test('item 5: legacy pages, shared styles and removed UI are visible but APIs are not', async () => {
  for (const filename of ['src/pages/home.tsx', 'src/pages/account/index.jsx', 'src/styles/globals.css', 'src/styles/theme.scss', modified.filename, 'src/app/settings/page.tsx']) {
    for (const status of ['modified', 'removed']) {
      assert.equal((await decision({ files: [{ filename, status }, added] })).state, 'failure', filename);
      assert.equal((await decision({ files: [{ filename, status }] })).state, 'success', filename);
      assert.equal((await decision({ title: 'HTPR-1 [BUGFIX] Restore', files: [{ filename, status }] })).state, 'success', filename);
    }
  }
  for (const filename of ['src/pages/api/test.tsx', 'src/app/api/test/route.tsx', 'src/pages/home.test.tsx', 'src/styles/theme.stories.css']) {
    assert.equal((await decision({ files: [{ filename, status: 'removed' }] })).description, 'No visible UI change');
  }
});

test('item 6: exact normalized New elements entries use index parent identities', async () => {
  const react = [{ userId: 6, emoji: '👍' }];
  const named = (text) => wireframe({ text: `https://hypertask.app/wireframes/a\n${text}`, reactions: react });
  assert.equal((await decision({ files: [added], comments: [named('New elements: Example_Panel')] })).state, 'success');
  const panel = { ...added, filename: 'src/components/Panel.tsx' };
  for (const text of ['New elements: ExamplePanel', 'Panel is discussed here', 'New elements: none', 'New elements: none\nPanel', '<p>New elements: none</p><p>Panel</p>']) {
    assert.equal((await decision({ files: [panel], comments: [named(text)] })).state, 'failure', text);
  }
  const indices = ['First', 'Second'].map((name) => ({ ...added, filename: `src/components/${name}/index.tsx` }));
  assert.equal((await decision({ files: indices, comments: [named('New elements: First, Second')] })).state, 'success');
  assert.equal((await decision({ files: indices, comments: [named('New elements: First')] })).state, 'failure');
  assert.equal((await decision({ files: indices, comments: [named('New elements: index')] })).state, 'failure');
  assert.equal((await decision({ files: [panel], comments: [wireframe(), yes({ text: '<p>yes</p><p>New elements: Panel</p>' })] })).state, 'success');
  const stale = named('New elements: Panel');
  const latest = wireframe({ createdAt: '2026-10-10T12:02:00Z', reactions: react });
  assert.equal((await decision({ files: [panel], comments: [stale, latest] })).state, 'failure');
  assert.equal((await decision({ files: [panel], comments: [wireframe(), yes({ text: 'yes\nNew elements: Panel' }), yes({ id: 3, text: 'yes\nNew elements: none', createdAt: '2026-10-10T12:02:00Z' })] })).state, 'failure');
});

test('item 7: reconciliation caches, caps reads including pages and stops after 429 or 5xx', async () => {
  const { run } = await gate;
  const prs = Array.from({ length: 124 }, (_, i) => pr(i + 1, { title: `HTPR-${Math.max(1, i)} [FEATURE] UI` }));
  const execute = async (fetchImpl) => {
    const fixture = apiFixture({ prs, files: [modified, added] });
    const logs = [];
    assert.equal(await run(['--reconcile'], { env, github: fixture.github, fetchImpl, log: (line) => logs.push(JSON.parse(line)) }), 0);
    return { posts: fixture.calls.filter((call) => call.method === 'POST'), logs };
  };
  let reads = 0;
  const capped = await execute(async (url) => { reads++; return commentsFetch(url); });
  assert.equal(reads, 120);
  assert.equal(capped.posts.length, 124);
  assert.equal(capped.posts.filter((post) => post.body.state === 'pending').length, 63);
  assert.equal(capped.logs.filter((line) => line.state === 'deferred').length, 63);
  for (const status of [429, 500, 503]) {
    reads = 0;
    const stopped = await execute(async () => ++reads === 1 ? response({ comments: [] }) : response({}, status));
    assert.equal(reads, 2, `HTTP ${status}`);
    assert.equal(stopped.posts.length, 124);
    assert.ok(stopped.posts.every((post) => post.body.state !== 'error'));
    assert.ok(stopped.logs.some((line) => line.state === 'deferred' && line.description.includes(`HTTP ${status}`)));
  }
  reads = 0;
  const paged = await execute(async () => response({ comments: [], nextCursor: String(++reads) }));
  assert.equal(reads, 120);
  assert.equal(paged.posts.length, 124);
  assert.deepEqual([...new Set(paged.posts.map((post) => post.body.state))], ["pending"]);
  assert.equal(paged.logs.filter((line) => line.state === 'deferred').length, 124);
  const mixed = apiFixture({ prs: [pr(1, { title }), pr(2, { title: 'HTPR-2 [FEATURE] UI' }), pr(3, { user: { login: 'dependabot[bot]' } })], files: [modified, added] });
  reads = 0;
  assert.equal(await run(['--reconcile'], { env, github: mixed.github, fetchImpl: async () => { reads++; return response({}, 429); }, log: () => {} }), 0);
  assert.equal(reads, 1);
  assert.deepEqual(mixed.calls.filter((call) => call.method === 'POST').map((call) => [call.endpoint, call.body.state]), [[`repos/fixture/repo/statuses/${pr(1).head.sha}`, 'pending'], [`repos/fixture/repo/statuses/${pr(2).head.sha}`, 'pending'], [`repos/fixture/repo/statuses/${pr(3).head.sha}`, 'success']]);
});

test('item 8: re-read immediately before posting and evaluate changed heads with fresh files', async () => {
  const { run } = await gate;
  for (const oldError of [false, true]) {
    const original = pr(1);
    const current = pr(1, { title, head: { sha: 'c'.repeat(40) } });
    const fixture = apiFixture({ prs: [original], currentPr: current });
    let filesReads = 0;
    const github = (endpoint, options) => {
      if (/\/files\?/.test(endpoint)) {
        filesReads++;
        if (oldError && filesReads === 1) throw new Error('old head files failed');
        return Promise.resolve(filesReads === 1 ? [modified] : [added]);
      }
      return fixture.github(endpoint, options);
    };
    assert.equal(await run(['--reconcile'], { env, github, fetchImpl: commentsFetch, log: () => {} }), oldError ? 2 : 0);
    assert.equal(filesReads, 2);
    const posts = fixture.calls.filter((call) => call.method === 'POST');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].endpoint, `repos/fixture/repo/statuses/${current.head.sha}`);
    assert.equal(posts[0].body.state, 'failure');
    assert.ok(fixture.calls.at(-2).endpoint.endsWith('/pulls/1'));
  }
  for (const finalReadFailure of [false, true]) {
    const fixture = apiFixture();
    let reads = 0;
    const github = (endpoint, options) => {
      if (/\/pulls\/1$/.test(endpoint) && ++reads > 1) {
        if (finalReadFailure) throw new Error('cannot validate current head');
        return Promise.resolve(pr(1, { head: { sha: reads.toString(16).padStart(40, 'a') } }));
      }
      return fixture.github(endpoint, options);
    };
    await run(['--reconcile'], { env, github, fetchImpl: commentsFetch, log: () => {} });
    assert.ok(fixture.calls.every((call) => call.method !== 'POST'));
    assert.ok(reads <= 4);
  }
});

test('CI policy records ux-signoff without making it required', () => {
  const policy = readFileSync(path.join(root, 'docs/ci-policy.yml'), 'utf8');
  const section = policy.match(/^ux_signoff:\n(?:[ \t].*\n|\n)+/m)?.[0];
  assert.ok(section);
  assert.match(section, /context: ux-signoff/);
  assert.match(section, /workflow: \.github\/workflows\/ux-signoff-gate\.yml/);
  assert.match(section, /script: \.github\/scripts\/ux-signoff-gate\.mjs/);
  assert.match(section, /required: false/);
  assert.match(section, /HT Product Lead.*statuses.*seeded.*all open PRs/);
  for (const line of policy.split('\n').filter((line) => /contexts:|required_status_checks:/.test(line))) assert.ok(!line.includes('ux-signoff'));
});

test('status cursor: every PR is read within ceil(reads / budget) sweeps and statuses per head stay bounded', async () => {
  const { run } = await gate;
  for (const pages of [1, 13]) {
    const total = 650;
    const prs = Array.from({ length: total }, (_, i) => pr(i + 1, { title: `HTPR-${i + 1} [FEATURE] UI`, head: { sha: (i + 1).toString(16).padStart(40, '0') } }));
    const store = new Map();
    let clock = Date.parse('2026-10-12T00:00:00Z');
    const github = async (endpoint, options = {}) => {
      if (options.method === 'POST') {
        const sha = endpoint.split('/').at(-1);
        store.set(sha, [{ ...options.body, updated_at: new Date(clock).toISOString() }, ...(store.get(sha) ?? [])]);
        return {};
      }
      const page = Number(new URL(`https://fixture/${endpoint}`).searchParams.get('page'));
      if (/\/pulls\?/.test(endpoint)) return prs.slice((page - 1) * 100, page * 100);
      if (/\/files\?/.test(endpoint)) return [modified, added];
      if (/\/statuses\?/.test(endpoint)) return page === 1 ? (store.get(endpoint.split('/')[4]) ?? []) : [];
      return prs.find((item) => item.number === Number(endpoint.split('/').at(-1)));
    };
    const read = new Set();
    const fetchImpl = async (url) => {
      if (new URL(String(url)).pathname === '/api/mcp/tasks') return ticketResponse(url);
      const params = new URL(String(url)).searchParams;
      read.add(params.get('ticket_number'));
      const next = Number(params.get('cursor') ?? 0) + 1;
      return response({ comments: [], nextCursor: next < pages ? String(next) : null });
    };
    const sweep = async () => {
      await run(['--reconcile'], { env, github, fetchImpl, log: () => {}, now: () => clock });
      clock += 600000;
    };
    const sweeps = Math.ceil(total / Math.floor(120 / (pages + 1)));
    for (let index = 0; index < sweeps; index++) await sweep();
    assert.equal(read.size, total, `${pages} page(s): every PR read within ${sweeps} sweeps`);
    for (let index = 0; index < 144; index++) await sweep();
    const perHead = Math.max(...[...store.values()].map((list) => list.length));
    assert.ok(perHead <= 2 + 24 + 1, `${pages} page(s): ${perHead} statuses on one head`);
  }
});

test('a Hypertask outage turns an earlier green to pending; budget exhaustion keeps it', async () => {
  const { run } = await gate;
  const green = [{ context: 'ux-signoff', state: 'success', description: 'Wireframe and new elements have UX signoff', updated_at: new Date().toISOString() }];
  const outage = apiFixture({ prs: [pr(1, { title: 'HTPR-2 [FEATURE] UI' })], files: [modified, added], statuses: green });
  await run(['--reconcile'], { env, github: outage.github, fetchImpl: async () => response({}, 503), log: () => {} });
  assert.deepEqual(outage.calls.filter((call) => call.method === 'POST').map((call) => call.body.state), ['pending']);
  const prs = Array.from({ length: 121 }, (_, i) => pr(i + 1, { title: `HTPR-${i + 1} [FEATURE] UI`, head: { sha: (i + 1).toString(16).padStart(40, '0') } }));
  const busy = apiFixture({ prs, files: [modified, added], statuses: green });
  await run(['--reconcile'], { env, github: busy.github, fetchImpl: commentsFetch, log: () => {} });
  assert.equal(busy.calls.filter((call) => call.method === 'POST').length, 60);
});

test("Valentin's yes that quotes the wireframe link still approves it", async () => {
  assert.equal((await decision({ comments: [wireframe(), yes({ text: '<p>yes https://hypertask.app/wireframes/htpr-1</p>' })] })).state, 'success');
});

test('an agent-edited verdict is not Valentin\'s: a "no" turned "yes" by an agent fails', async () => {
  const edited = { text: '<p>yes go</p>', editedAt: '2026-10-10T12:05:00Z' };
  for (const editedBy of [{ userId: 6, agentId: 'agent-1', isAgent: true }, { userId: 6, agentId: null, isAgent: true }, null, undefined]) {
    assert.equal((await decision({ comments: [wireframe(), yes({ ...edited, editedBy })] })).state, 'failure');
  }
  assert.equal((await decision({ comments: [wireframe(), yes({ ...edited, editedBy: { userId: 6, agentId: null } })] })).state, 'success');
});

test('an agent-edited refusal still blocks an earlier yes or thumbs up until a fresh yes', async () => {
  const agentEditedNo = yes({ id: 3, text: '<p>no</p>', createdAt: '2026-10-10T12:02:00Z', editedAt: '2026-10-10T12:03:00Z', editedBy: { userId: 6, agentId: 'agent-1', isAgent: true } });
  assert.equal((await decision({ comments: [wireframe(), yes(), agentEditedNo] })).state, 'failure');
  assert.equal((await decision({ comments: [wireframe({ reactions: [{ userId: 6, emoji: '👍' }] }), agentEditedNo] })).state, 'failure');
  assert.equal((await decision({ comments: [wireframe(), yes(), agentEditedNo, yes({ id: 4, createdAt: '2026-10-10T12:04:00Z' })] })).state, 'success');
});

for (const status of [403, 429]) {
  test(`GitHub GET rate limit HTTP ${status} still waits until reset then succeeds`, async () => {
    const { createGithub } = await gate;
    let clock = 1000000;
    let calls = 0;
    const waits = [];
    const github = createGithub({ env, now: () => clock, log: () => {},
      sleep: async (ms) => { waits.push(ms); clock += ms; },
      fetchImpl: async () => {
        if (++calls === 1) return response({ message: 'API rate limit exceeded for installation' }, status, {
          'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1005',
        });
        assert.equal(clock, 1005000);
        return response({ ok: true });
      },
    });
    assert.deepEqual(await github('repos/fixture/repo/pulls/1'), { ok: true });
    assert.deepEqual(waits, [5000]);
    assert.equal(calls, 2);
  });
}

for (const options of [
  { method: 'POST', body: { state: 'success' } }, { method: 'PATCH' },
  { method: 'GET', body: { state: 'success' } },
]) {
  for (const [status, limited] of [[403, true], [429, true], [403, false], [404, false], [500, false]]) {
    test(`REST ${options.method} with body=${!!options.body} HTTP ${status} limited=${limited} never sleeps or retries`, async () => {
      const { createGithub } = await gate;
      let calls = 0;
      const github = createGithub({ env, now: () => 1000000,
        sleep: () => assert.fail('writes must not wait'),
        fetchImpl: async () => {
          calls++;
          return response({}, status, limited ? { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1005' } : {});
        },
      });
      await assert.rejects(github('repos/fixture/repo/statuses/sha', options), (error) => limited
        ? error.rateLimited && /skipped: GitHub rate limited until 1970-01-01T00:16:45.000Z;/.test(error.message)
        : !error.rateLimited && error.message === `GitHub API returned HTTP ${status}`);
      assert.equal(calls, 1, 'no second write can publish a stale approval');
    });
  }
}

for (const stage of ['list', 'cursor', 'files', 'publish']) {
  test(`UX rate limit at ${stage} ends as skipped with exit 0 and no error status`, async () => {
    const { createGithub, run } = await gate;
    const fixture = apiFixture();
    const output = [];
    const github = createGithub({ env, now: () => 1000000, log: () => {},
      sleep: () => assert.fail('must not wait beyond cap'),
      fetchImpl: async (url, options) => {
        const endpoint = url.replace('https://api.github.com/', '');
        const limit = stage === 'list' ? endpoint.includes('/pulls?') :
          stage === 'cursor' ? endpoint.includes('/statuses?') :
          stage === 'files' ? endpoint.includes('/files?') : options.method === 'POST';
        if (limit) return response({ message: 'rate limit exceeded' }, 403, {
          'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '5000',
        });
        return response(await fixture.github(endpoint, options));
      },
    });
    assert.equal(await run(['--reconcile'], { env, github, fetchImpl: commentsFetch, log: (line) => output.push(line) }), 0);
    assert.match(output.at(-1), /::warning::skipped: GitHub rate limited until/);
    assert.ok(fixture.calls.every((call) => call.method !== 'POST'));
    assert.ok(output.every((line) => !line.includes('"state": "error"')));
  });
}

for (const status of [403, 404, 500]) {
  test(`UX non-rate-limit ${status} still refused next to reset recovery now allowed`, async () => {
    const { createGithub, run } = await gate;
    const github = createGithub({ env, sleep: async () => {}, fetchImpl: async () => response({ message: 'Forbidden' }, status) });
    await assert.rejects(run(['--reconcile'], { env, github, log: () => {} }), new RegExp(`HTTP ${status}`));
  });
}

test('UX reuses cursor status reads on unchanged heads but refreshes a changed head', async () => {
  const { run } = await gate;
  const unchanged = apiFixture({ files: [] });
  assert.equal(await run(['--reconcile'], { env, github: unchanged.github, log: () => {} }), 0);
  assert.equal(unchanged.calls.filter((call) => call.endpoint.includes('/statuses?')).length, 1);
  const updated = pr(1, { head: { sha: 'c'.repeat(40) } });
  const changed = apiFixture({ files: [], currentPr: updated });
  assert.equal(await run(['--reconcile'], { env, github: changed.github, log: () => {} }), 0);
  const reads = changed.calls.filter((call) => call.endpoint.includes('/statuses?'));
  assert.ok(reads.some((call) => call.endpoint.includes(updated.head.sha)), 'new heads must get a fresh status read');
  const posts = changed.calls.filter((call) => call.method === 'POST');
  assert.equal(posts.length, 1);
  assert.ok(posts[0].endpoint.endsWith(updated.head.sha));
});

for (const method of ['GET', 'POST']) {
  test(`gh fallback ${method} ${method === 'GET' ? 'still waits and retries' : 'skips without waiting or a second POST'}`, async () => {
    const { createGithub } = await gate;
    let calls = 0;
    let clock = 1000000;
    const waits = [];
    const github = createGithub({ env: {}, now: () => clock, log: () => {},
      sleep: async (ms) => {
        assert.equal(method, 'GET', 'writes must not sleep');
        waits.push(ms); clock += ms;
      },
      exec: (_, args, options) => {
        assert.ok(args.includes('--include'));
        assert.equal(options.input, method === 'POST' ? '{"state":"success"}' : undefined);
        if (++calls === 1) throw Object.assign(new Error('private gh error'), {
          status: 1, stdout: 'HTTP/2.0 403 Forbidden\r\nX-Ratelimit-Remaining: 0\r\nX-Ratelimit-Reset: 1005\r\n\r\n{}',
        });
        return 'HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n{"ok":true}';
      },
    });
    const result = github('repos/fixture/repo/statuses/sha', { method, ...(method === 'POST' ? { body: { state: 'success' } } : {}) });
    if (method === 'GET') assert.deepEqual(await result, { ok: true });
    else await assert.rejects(result, (error) => error.rateLimited && /skipped: GitHub rate limited until 1970-01-01T00:16:45.000Z;/.test(error.message));
    assert.deepEqual(waits, method === 'GET' ? [5000] : []);
    assert.equal(calls, method === 'GET' ? 2 : 1);
  });
}

for (const stage of ['statuses', 'current PR', 'publish']) {
  test(`UX evaluation error before rate-limited ${stage} remains exit 2`, async () => {
    const { createGithub, run } = await gate;
    const fixture = apiFixture({ prs: [pr(1, { title })], files: [added] });
    const output = [];
    let statusReads = 0;
    let prReads = 0;
    const github = createGithub({ env, now: () => 1000000, log: () => {},
      sleep: () => assert.fail('no write retry or over-budget read wait'),
      fetchImpl: async (url, options) => {
        const endpoint = url.replace('https://api.github.com/', '');
        let limited = false;
        if (stage === 'statuses' && endpoint.includes('/statuses?')) {
          if (++statusReads === 1) return response({}, 403);
          limited = true;
        }
        if (stage === 'current PR' && endpoint.endsWith('/pulls/1')) limited = ++prReads > 1;
        if (stage === 'publish' && options.method === 'POST') limited = true;
        if (limited) return response({}, 403, {
          'x-ratelimit-remaining': '0', 'x-ratelimit-reset': stage === 'publish' ? '1005' : '5000',
        });
        return response(await fixture.github(endpoint, options));
      },
    });
    assert.equal(await run(['--reconcile'], {
      env: { ...env, MCP_TOKEN: '' }, github,
      fetchImpl: () => assert.fail('missing MCP token must produce an evaluation error'),
      log: (line) => output.push(line),
    }), 2);
    assert.match(output.at(-1), /::warning::skipped: GitHub rate limited until/);
    assert.ok(fixture.calls.every((call) => call.method !== 'POST'));
  });
}

test('still allowed: reused UI needs no ticket read, so a later rate-limit skip exits 0', async () => {
  const { createGithub, run } = await gate;
  const fixture = apiFixture({ prs: [pr(1, { title })], files: [modified] });
  const output = [];
  let prReads = 0;
  const github = createGithub({ env, now: () => 1000000, log: () => {},
    sleep: () => assert.fail('no over-budget read wait'),
    fetchImpl: async (url, options) => {
      const endpoint = url.replace('https://api.github.com/', '');
      if (endpoint.endsWith('/pulls/1') && ++prReads > 1) {
        return response({}, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '5000' });
      }
      return response(await fixture.github(endpoint, options));
    },
  });
  assert.equal(await run(['--reconcile'], {
    env: { ...env, MCP_TOKEN: '' }, github,
    fetchImpl: () => assert.fail('reused UI must not read the ticket'),
    log: (line) => output.push(line),
  }), 0);
  assert.match(output.at(-1), /::warning::skipped: GitHub rate limited until/);
  assert.ok(fixture.calls.every((call) => call.method !== 'POST'));
});

test('an earlier genuine UX failure is not hidden by a later rate-limit skip', async () => {
  const { createGithub, run } = await gate;
  const fixture = apiFixture({ prs: [pr(1), pr(2)] });
  const github = createGithub({ env, now: () => 1000000, log: () => {}, sleep: () => assert.fail('over cap'),
    fetchImpl: async (url, options) => {
      const endpoint = url.replace('https://api.github.com/', '');
      if (endpoint.endsWith('/pulls/1')) return response({ message: 'Forbidden' }, 403);
      if (endpoint.endsWith('/pulls/2')) return response({ message: 'rate limit' }, 403, {
        'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '5000',
      });
      return response(await fixture.github(endpoint, options));
    },
  });
  assert.equal(await run(['--reconcile'], { env, github, log: () => {} }), 2);
  assert.ok(fixture.calls.every((call) => call.method !== 'POST'));
});

test('YPER4-622: New elements with a bracketed note and "and" still name each element', async () => {
  const section = { filename: 'src/components/Modals/Settings/GitHubSection.tsx', status: 'added' };
  const htpr7515 = wireframe({
    id: 296044,
    text: '<p>Wireframe ready.</p><p>https://hypertask.app/wireframes/htpr-7515</p><p>Question: <span data-type="mention">Valentin Yeo</span></p><p>New elements: GitHubSection (Connect settings page) and a Connect GitHub row in Commands. Build Connect GitHub this way?</p>',
  });
  const valentinYes = yes({ id: 296782, text: '<p>Yes. That works.</p>' });
  assert.equal((await decision({ files: [section], comments: [htpr7515, valentinYes] })).state, 'success', 'still allowed: a named element with a note');
  const unnamed = { filename: 'src/components/Modals/Settings/GitLabSection.tsx', status: 'added' };
  const refused = await decision({ files: [section, unnamed], comments: [htpr7515, valentinYes] });
  assert.equal(refused.state, 'failure', 'still refused: an element the comment does not name');
  assert.match(refused.description, /GitLabSection needs Valentin's yes by name/);
});

test('YPER4-627: reused UI with no new component file passes without a wireframe; a new component still needs his yes by name', async () => {
  for (const files of [[modified], [{ filename: 'src/app/settings/page.tsx', status: 'modified' }], [{ ...added, filename: 'src/app/inbox/page.tsx' }]]) {
    const reused = await decision({ files });
    assert.equal(reused.state, 'success', `now passes: ${files[0].filename}`);
    assert.match(reused.description, /No new component file/);
  }
  const unapproved = await decision({ files: [modified, added] });
  assert.equal(unapproved.state, 'failure', 'still refused: a new component with no wireframe');
  assert.match(unapproved.details[0], /yes on a wireframe on HTPR-7072/);
  assert.match(unapproved.details[1], /ExamplePanel needs Valentin's yes by name/);
  const unnamed = await decision({ files: [modified, added], comments: [wireframe({ text: '<p>https://hypertask.app/wireframes/decision-inbox</p>' }), yes()] });
  assert.equal(unnamed.state, 'failure', 'still refused: a wireframe yes that does not name the new component');
  assert.match(unnamed.description, /ExamplePanel needs Valentin's yes by name/);
  assert.equal((await decision({ files: [modified, added], comments: [wireframe(), yes()] })).state, 'success', 'still allowed: the named component after his yes');
  assert.equal((await decision({ title: 'No ticket here', files: [modified] })).state, 'failure', 'still refused: a title with no ticket');
});

for (const approval of ['ticket', 'parent']) for (const cause of ['rate limit', 'network', 'HTTP 503']) for (const revoke of [false, true]) {
  test(`YPER4-630: ${approval}: ${cause}: ${revoke ? 'withdrawn approval is refused' : 'unchanged approval stays allowed'} after a GitHub wait between same-ticket PRs`, async () => {
    const { run } = await gate;
    const fixture = apiFixture({
      prs: [pr(1, { title: 'HTPR-1 [FEATURE] First UI' }), pr(2, { title: 'HTPR-1 [FEATURE] Second UI' })],
      files: [modified, added],
    });
    let waited = false;
    let limited = false;
    let commentReads = 0;
    let parentReads = 0;
    const waits = [];
    const output = [];
    const fetchImpl = async (url, options) => {
      const parsed = new URL(String(url));
      if (parsed.hostname === 'api.github.com') {
        const endpoint = parsed.pathname.slice(1) + parsed.search;
        if (endpoint.endsWith('/pulls/2/files?per_page=100&page=1') && !limited) {
          limited = true;
          waited = true;
          if (cause === 'network') throw new Error('fixture connection reset');
          return cause === 'HTTP 503' ? response({}, 503) : response({ message: 'rate limit' }, 429, { 'retry-after': '1' });
        }
        if (options.method === 'POST') {
          return response(await fixture.github(endpoint, { method: 'POST', body: JSON.parse(options.body) }));
        }
        return response(await fixture.github(endpoint));
      }
      assert.equal(options.headers.Authorization, 'Bearer hypertask-fixture');
      if (parsed.pathname === '/api/mcp/tasks') {
        parentReads++;
        return ticketResponse(url, approval === 'parent' ? 'HTPR-2' : null);
      }
      const approvedTicket = approval === 'parent' ? 'HTPR-2' : 'HTPR-1';
      if (parsed.searchParams.get('ticket_number') !== approvedTicket) return response({ success: true, comments: [], nextCursor: null });
      commentReads++;
      return response({ success: true, comments: [wireframe(), yes({ text: waited && revoke ? 'no, stop' : 'yes go' })], nextCursor: null });
    };
    assert.equal(await run(['--reconcile'], {
      env, fetchImpl, sleep: async (ms) => { waits.push(ms); waited = true; },
      log: (line) => output.push(JSON.parse(line)),
    }), 0);
    assert.equal(commentReads, 2);
    if (approval === 'parent') assert.equal(parentReads, 2);
    assert.deepEqual(waits, [1000]);
    assert.deepEqual(fixture.calls.filter((call) => call.method === 'POST').map((call) => call.body.state),
      ['success', revoke ? 'failure' : 'success']);
    assert.deepEqual(output.map((item) => item.state), ['success', revoke ? 'failure' : 'success']);
  });
}

for (const cause of ['network', 'HTTP 503']) {
  test(`YPER4-630: noWait never retries ${cause} after evaluating approval`, async () => {
    const { run } = await gate;
    const fixture = apiFixture({ prs: [pr(1, { title: 'HTPR-1 [FEATURE] UI' })], files: [modified, added] });
    let prReads = 0;
    const waits = [];
    const fetchImpl = async (url, options) => {
      const parsed = new URL(String(url));
      if (parsed.hostname !== 'api.github.com') return parsed.pathname === '/api/mcp/tasks'
        ? ticketResponse(url) : response({ success: true, comments: [wireframe(), yes()], nextCursor: null });
      const endpoint = parsed.pathname.slice(1) + parsed.search;
      if (endpoint.endsWith('/pulls/1') && ++prReads === 2) {
        if (cause === 'network') throw new Error('fixture connection reset');
        return response({}, 503);
      }
      return response(await fixture.github(endpoint, options));
    };
    assert.equal(await run(['--reconcile'], { env, fetchImpl, sleep: async (ms) => waits.push(ms), log: () => {} }), 2);
    assert.equal(prReads, 2);
    assert.deepEqual(waits, []);
    assert.deepEqual(fixture.calls.filter((call) => call.method === 'POST'), []);
  });
}

test('YPER4-630: gh fallback discards cached approval across a rate-limit wait', async () => {
  const { run } = await gate;
  const directory = mkdtempSync(path.join(tmpdir(), 'ux-gh-wait-'));
  const originalPath = process.env.PATH;
  try {
    const prs = [pr(1, { title: 'HTPR-1 [FEATURE] First' }), pr(2, { title: 'HTPR-1 [FEATURE] Second' })];
    const state = path.join(directory, 'state.json');
    writeFileSync(state, JSON.stringify({ prs, files: [modified, added], limited: false, posts: [] }));
    writeFileSync(path.join(directory, 'gh'), `#!${process.execPath}
const fs = require('node:fs');
const state = ${JSON.stringify(state)};
const fixture = JSON.parse(fs.readFileSync(state));
const args = process.argv.slice(2);
const endpoint = args[args.indexOf('--method') + 2];
let data;
if (args.includes('POST')) {
  fixture.posts.push(JSON.parse(fs.readFileSync(0, 'utf8')));
  data = {};
} else if (endpoint.includes('/pulls?')) data = fixture.prs;
else if (endpoint.includes('/statuses?')) data = [];
else if (endpoint.includes('/pulls/2/files?') && !fixture.limited) {
  fixture.limited = true;
  fs.writeFileSync(state, JSON.stringify(fixture));
  process.stdout.write('HTTP/2.0 429 Too Many Requests\\r\\nRetry-After: 1\\r\\n\\r\\n{}');
  process.exit(1);
} else if (endpoint.includes('/files?')) data = fixture.files;
else data = fixture.prs.find((pr) => pr.number === Number(endpoint.split('/').at(-1)));
fs.writeFileSync(state, JSON.stringify(fixture));
process.stdout.write('HTTP/2.0 200 OK\\r\\n\\r\\n' + JSON.stringify(data));
`, { mode: 0o700 });
    process.env.PATH = directory + path.delimiter + originalPath;
    let waited = false;
    let commentReads = 0;
    const waits = [];
    assert.equal(await run(['--reconcile'], {
      env: { ...env, GH_TOKEN: '' },
      fetchImpl: async (url) => {
        if (new URL(String(url)).pathname === '/api/mcp/tasks') return ticketResponse(url);
        commentReads++;
        return response({ success: true, comments: [wireframe(), yes({ text: waited ? 'no, stop' : 'yes' })], nextCursor: null });
      },
      sleep: async (ms) => { waits.push(ms); waited = true; }, log: () => {},
    }), 0);
    assert.equal(commentReads, 2);
    assert.deepEqual(waits, [1000]);
    assert.deepEqual(JSON.parse(readFileSync(state)).posts.map((post) => post.state), ['success', 'failure']);
  } finally {
    process.env.PATH = originalPath;
    rmSync(directory, { recursive: true, force: true });
  }
});
