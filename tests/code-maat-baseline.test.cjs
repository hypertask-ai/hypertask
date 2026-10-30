const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync, chmodSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const script = path.join(__dirname, '../scripts/analysis/code-maat-baseline.py');

function validate(analysis, output) {
  return spawnSync('python3', ['-c', `
import importlib.util, sys
spec = importlib.util.spec_from_file_location('baseline', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
try:
    module.validate_output(sys.argv[2], sys.stdin.read())
except ValueError as error:
    print(error, file=sys.stderr)
    sys.exit(1)
`, script, analysis], { input: output, encoding: 'utf8' });
}

test('requires an explicit JAR and output directory', () => {
  const result = spawnSync('python3', [script], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--jar/);
  assert.match(result.stderr, /--output/);
});

test('rejects an untrusted JAR', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'maat-test-'));
  try {
    const jar = path.join(dir, 'fake.jar');
    writeFileSync(jar, 'not the official jar');
    const result = spawnSync('python3', [script, '--jar', jar, '--output', dir], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /JAR does not match/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accepts valid CSV and rejects successful parser errors', () => {
  const valid = {
    summary: 'statistic,value\nnumber-of-commits,1\nnumber-of-entities,2\nnumber-of-entities-changed,3\nnumber-of-authors,1\n',
    revisions: 'entity,n-revs\nsrc/file.ts,2\n',
    coupling: 'entity,coupled,degree,average-revs\nsrc/a.ts,src/b.ts,80,5\n',
  };
  for (const [analysis, csv] of Object.entries(valid)) {
    assert.equal(validate(analysis, csv).status, 0);
    assert.notEqual(validate(analysis, 'Invalid argument: parser error\n').status, 0);
    assert.notEqual(validate(analysis, csv + 'broken,row,extra,values,here\n').status, 0);
  }
  assert.notEqual(validate('coupling', 'entity,coupled,degree,average-revs\na,b,101,5\n').status, 0);
  assert.notEqual(validate('revisions', 'entity,n-revs\na,0\n').status, 0);
});

function fixture(shallow = false, parserError = false) {
  const dir = mkdtempSync(path.join(tmpdir(), 'maat-cli-'));
  const bin = path.join(dir, 'bin');
  const output = path.join(dir, 'output');
  const jar = path.join(dir, 'fake.jar');
  const historyPath = path.join(dir, 'history-path');
  mkdirSync(bin);
  mkdirSync(output);
  writeFileSync(jar, 'fixture jar');
  const git = path.join(bin, 'git');
  writeFileSync(git, `#!/usr/bin/python3
import sys
args = sys.argv[1:]
if args == ['rev-parse', '--is-shallow-repository']:
    print('${shallow ? 'true' : 'false'}')
elif args == ['rev-parse', '--is-inside-work-tree']:
    sys.exit(1)
elif args[:3] == ['-c', 'core.quotePath=true', 'log']:
    print('--abc123--2026-10-02--Example Author\\n1\\t0\\tsrc/a.ts')
else:
    sys.exit(2)
`);
  const java = path.join(bin, 'java');
  writeFileSync(java, `#!/usr/bin/python3
import pathlib, sys
args = sys.argv[1:]
log = pathlib.Path(args[args.index('-l') + 1])
if log.read_text() != '--abc123--2026-10-02--Example Author\\n1\\t0\\tsrc/a.ts\\n':
    sys.exit(2)
pathlib.Path(${JSON.stringify(historyPath)}).write_text(str(log))
analysis = args[args.index('-a') + 1]
outputs = {
    'summary': 'statistic,value\\nnumber-of-entities,2\\nnumber-of-authors,1\\nnumber-of-commits,1\\nnumber-of-entities-changed,3\\n',
    'revisions': 'entity,n-revs\\nsrc/z.ts,1\\nsrc/b.ts,3\\nsrc/a.ts,3\\n',
    'coupling': 'entity,coupled,degree,average-revs\\nsrc/z.ts,src/b.ts,70,4\\nsrc/b.ts,src/c.ts,90,2\\nsrc/a.ts,src/c.ts,90,2\\n',
}
print('Invalid argument: parser error' if ${parserError ? 'analysis == "coupling"' : 'False'} else outputs[analysis], end='')
`);
  chmodSync(git, 0o755);
  chmodSync(java, 0o755);
  const result = spawnSync('python3', ['-c', `
import hashlib, importlib.util, sys
script, jar, output = sys.argv[1:]
spec = importlib.util.spec_from_file_location('baseline', script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.JAR_SHA256 = hashlib.sha256(open(jar, 'rb').read()).hexdigest()
sys.argv = [script, '--jar', jar, '--output', output]
module.main()
`, script, jar, output], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, TMPDIR: dir },
  });
  return { dir, output, historyPath, result };
}

test('rejects shallow history after trusting the fixture JAR', () => {
  const { dir, output, result } = fixture(true);
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /complete Git history required/);
    assert.deepEqual(readdirSync(output), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes canonical baseline files from CLI processes', () => {
  const { dir, output, historyPath, result } = fixture();
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(output).sort(), ['coupling.csv', 'report.md', 'revisions.csv', 'summary.csv']);
    assert.equal(readFileSync(path.join(output, 'summary.csv'), 'utf8'), 'statistic,value\nnumber-of-authors,1\nnumber-of-commits,1\nnumber-of-entities,2\nnumber-of-entities-changed,3\n');
    assert.equal(readFileSync(path.join(output, 'revisions.csv'), 'utf8'), 'entity,n-revs\nsrc/a.ts,3\nsrc/b.ts,3\nsrc/z.ts,1\n');
    assert.equal(readFileSync(path.join(output, 'coupling.csv'), 'utf8'), 'entity,coupled,degree,average-revs\nsrc/a.ts,src/c.ts,90,2\nsrc/b.ts,src/c.ts,90,2\nsrc/z.ts,src/b.ts,70,4\n');
    assert.equal(readFileSync(path.join(output, 'report.md'), 'utf8'), `# Code-maat baseline

Snapshot: \`4c1777e08431308d563cc7c7e12ffda806004301\`
Committer window: 2026-10-01T00:00:00Z inclusive to 2026-10-30T00:00:00Z exclusive.
Official code-maat 1.0.4; default analysis thresholds.
Co-change is a proxy, not measured conflicts or throughput.

## Summary

- number-of-authors: 1
- number-of-commits: 1
- number-of-entities: 2
- number-of-entities-changed: 3

## Top revisions

- \`src/a.ts\`: 3
- \`src/b.ts\`: 3
- \`src/z.ts\`: 1

## Highest coupling

- \`src/a.ts\` / \`src/c.ts\`: 90%, average revisions 2
- \`src/b.ts\` / \`src/c.ts\`: 90%, average revisions 2
- \`src/z.ts\` / \`src/b.ts\`: 70%, average revisions 4
`);
    assert.equal(existsSync(readFileSync(historyPath, 'utf8')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects successful Java parser errors without partial output', () => {
  const { dir, output, historyPath, result } = fixture(false, true);
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid coupling output/);
    assert.deepEqual(readdirSync(output), []);
    assert.equal(existsSync(readFileSync(historyPath, 'utf8')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
