const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const regressionTests = [
  'ai-eval', 'ai-prompt-registry', 'ai-model-tracing', 'ai-error-tracking',
  'editor-ai-prompt', 'ai-output-style-unslop', 'ai-usage-attribution',
  'ai-chat-observability', 'task-summaries', 'comment-summary-lines',
  'task-writer-context-synthesis', 'task-writer-source-fidelity',
  'task-writer-board-templates', 'task-writer-board-research',
  'ai-gateway-key-routing', 'ai-gateway-key-required', 'ai-gateway-resolver-callers',
  'shared-ai-allowance', 'ai-model-stream-fallback', 'ai-label-classifier',
  'hyper-mentioned-cross-board-context', 'hyper-ai-parity-tools',
  'ai-chat-user-facing-errors', 'ai-native-bearer-auth', 'chat-stream-source',
  'ai-chat-background-persistence', 'ai-chat-stream-not-cancelled',
  'ai-chat-cancellation', 'posthog-error-dispatch', 'posthog-error-workflow',
  'report-client-error', 'posthog-error-alert', 'client-error-reporter',
].map((name) => `tests/${name}.test.${fs.existsSync(path.join(root, `tests/${name}.test.cjs`)) ? 'cjs' : 'ts'}`);

function git(...args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
function changedFiles() {
  return [...new Set([
    ...git('diff', '--name-only', 'origin/production...HEAD').split('\n'),
    ...git('diff', '--name-only', 'HEAD').split('\n'),
    ...git('ls-files', '--others', '--exclude-standard').split('\n'),
  ].filter((file) => file && fs.existsSync(path.join(root, file)) && !file.startsWith('.ai-check-')))];
}
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed`);
}

function staticChecks() {
  const temporary = fs.mkdtempSync(path.join(root, '.ai-check-'));
  try {
    // node_modules is shared, so generate the changed client only inside this worktree.
    const schema = fs.readFileSync(path.join(root, 'src/prisma/schema.prisma'), 'utf8')
      .replace('provider        = "prisma-client-js"', 'provider        = "prisma-client-js"\n  output          = "./client"');
    fs.writeFileSync(path.join(temporary, 'schema.prisma'), schema);
    run('npx', ['prisma', 'generate', '--schema', path.join(temporary, 'schema.prisma')]);
    const changed = changedFiles();
    fs.writeFileSync(path.join(temporary, 'tsconfig.json'), JSON.stringify({
      extends: path.join(root, 'tsconfig.json'),
      compilerOptions: { incremental: false, paths: { '@/*': [path.join(root, 'src/*')], '@prisma/client': [path.join(temporary, 'client')] } },
      include: [...changed.filter((file) => /\.tsx?$/.test(file)).map((file) => path.join(root, file)), path.join(root, 'src/**/*.d.ts')],
      exclude: [path.join(root, 'node_modules')],
    }));
    const result = spawnSync('npx', ['tsc', '--noEmit', '-p', path.join(temporary, 'tsconfig.json')], { cwd: root, encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
    const output = (result.stdout ?? '') + (result.stderr ?? '');
    process.stdout.write(output);
    const diagnostics = output.split('\n').filter((line) => /error TS\d+/.test(line));
    // Existing dependency/version drift is outside this ticket. No changed file may have a diagnostic.
    const preexisting = [
      'src/components/Modals/Sheets/AppSheet.tsx(2,17): error TS2305:',
      'src/components/Modals/Sheets/AppSheet.tsx(147,7): error TS2322:',
      'src/components/Modals/Sheets/AppSheet.tsx(170,13): error TS2322:',
      'src/lib/redis.ts(45,26): error TS2769:',
      'src/lib/state.tsx(8,3): error TS2305:',
    ];
    assert.ok(result.status === 0 || result.status === 2 && diagnostics.length > 0, 'TypeScript did not complete');
    assert.ok(diagnostics.every((line) => preexisting.some((diagnostic) => line.startsWith(diagnostic)) && !changed.some((file) => line.startsWith(`${file}(`))), 'New or changed-file TypeScript diagnostics');
    console.log(`Scoped TypeScript: ${diagnostics.length} pre-existing dependency diagnostics; zero changed-file diagnostics`);
    const lintFiles = changed.filter((file) => /\.(?:[cm]?js|tsx?)$/.test(file));
    run('npm', ['run', 'lint', '--', '--ignore-pattern', '**/*', '--ignore-pattern', '!**/', ...lintFiles.flatMap((file) => ['--ignore-pattern', `!${file}`])]);
    console.log('AI static verification passed');
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

const mode = process.argv[2];
if (mode === 'tests') {
  run('node', ['--test', '--test-concurrency=2', ...regressionTests.filter((file) => file.endsWith('.cjs'))]);
  for (const file of regressionTests.filter((file) => file.endsWith('.ts'))) run('node', [path.join(root, 'node_modules/tsx/dist/cli.mjs'), file]);
  console.log('AI regression verification passed');
} else if (mode === 'static') {
  staticChecks();
} else if (mode === 'diff') {
  const base = git('merge-base', 'HEAD', 'origin/production');
  const diff = git('diff', base, '--', '.', ':!GATES.md');
  assert.ok(!diff.split('\n').some((line) => line.startsWith('+') && !line.startsWith('+++') && line.includes('\u2014')), 'New em dash in diff');
  assert.equal(git('diff', base, '--', 'src/lib/aiModelOptions.ts', 'src/lib/ai/tools/constants.ts'), '', 'User model ids/options changed');
  const forbidden = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /(?:sk-ant-api\d+-|sk_live_)[A-Za-z0-9_-]{20,}/];
  assert.ok(forbidden[0].test('-----BEGIN ' + 'RSA' + ' PRIVATE KEY-----'));
  assert.ok(forbidden[1].test('sk_live_' + 'x'.repeat(20)));
  assert.ok(['+fixture' + String.fromCharCode(0x2014)].some((line) => line.startsWith('+') && line.includes(String.fromCharCode(0x2014))));
  for (const file of changedFiles().filter((file) => !file.endsWith('.log'))) {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(!content.includes('\u2014') || git('ls-files', file), `Em dash in new file ${file}`);
    assert.ok(forbidden.every((pattern) => !pattern.test(content)), `Possible secret in ${file}`);
  }
  run('git', ['diff', '--check', base]);
  assert.equal(git('branch', '--show-current'), 'htpr-6505');
  assert.equal(fs.realpathSync(root), '/home/valentin/projects/ht-wt-6505');
  console.log('AI scope verification passed');
} else if (mode === 'commit') {
  assert.equal(git('branch', '--show-current'), 'htpr-6505');
  const message = git('log', '-1', '--format=%B');
  assert.match(message, /^HTPR-6505: /);
  assert.ok(message.endsWith('Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'));
  const status = git('status', '--porcelain').split('\n').filter(Boolean);
  assert.ok(status.every((line) => line.endsWith('GATES.md')), 'Uncommitted code remains');
  console.log('AI commit verification passed');
} else {
  throw new Error('Expected tests, static, diff or commit');
}
