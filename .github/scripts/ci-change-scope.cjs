#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const { appendFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

function isCiExercisingFile(file) {
  return file === '.github/workflows/ci-tests.yml' || file.startsWith('.github/scripts/');
}

function isDocsOnlyFile(file) {
  if (isCiExercisingFile(file)) return false;
  return file.startsWith('docs/') || file.startsWith('.claude/') ||
    file.startsWith('scripts/self_hosted_agent/') || file.startsWith('.github/') ||
    (!file.includes('/') && file.endsWith('.md'));
}

function buildNeeded(files) {
  return !Array.isArray(files) || files.length === 0 || files.some(file =>
    typeof file !== 'string' || file.length === 0 || !isDocsOnlyFile(file));
}

function changeScope(event, base, head, git = args => execFileSync('git', args, {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
})) {
  if (event !== 'pull_request') return { build_needed: true, files: [] };
  try {
    if (!/^[a-f0-9]{40}$/.test(base || '') || !/^[a-f0-9]{40}$/.test(head || '')) {
      throw new Error('Missing PR commit SHA');
    }
    git(['fetch', '--depth=1', 'origin', base, head]);
    // Disable rename detection: moving source into docs must still run CI.
    const diff = git(['diff', '--no-renames', '--name-only', '-z', base, head]);
    if (!diff || !diff.endsWith('\0')) throw new Error('Empty or incomplete diff');
    const files = diff.slice(0, -1).split('\0');
    return { build_needed: buildNeeded(files), files };
  } catch {
    return { build_needed: true, files: [] };
  }
}

function selfCheck() {
  const assert = require('node:assert/strict');
  for (const [name, files, expected] of [
    ['docs only', ['docs/ci.yml', '.claude/config.json', 'notes.md'], false],
    ['mixed', ['docs/guide.md', 'package.json'], true],
    ['empty', [], true],
    ['source', ['src/app/page.tsx'], true],
    ['root README', ['README.md'], false],
    ['this workflow', ['.github/workflows/ci-tests.yml'], true],
    ['CI scripts', ['.github/scripts/select-tests.mjs'], true],
    ['other workflow', ['.github/workflows/app-smoke.yml'], false],
    ['self-hosted agent', ['scripts/self_hosted_agent/run.sh'], false],
    ['nested Markdown', ['foo/bar.md'], true],
    ['runtime Markdown', ['src/app/wiki/agents/agents.md'], true],
    ['renamed source to docs', ['src/old.js', 'docs/old.js'], true],
    ['newline in non-doc path', ['src/code.js\nREADME.md.js'], true],
    ['invalid entry', [''], true],
  ]) assert.equal(buildNeeded(files), expected, name);
  const base = 'a'.repeat(40);
  const head = 'b'.repeat(40);
  for (const [name, diff, expected] of [
    ['docs diff', 'docs/a.txt\0README.md\0', false],
    ['mixed diff', 'README.md\0src/a.js\0', true],
    ['empty diff', '', true],
    ['incomplete diff', 'README.md', true],
    ['renamed source diff', 'src/a.js\0docs/a.js\0', true],
  ]) {
    const calls = [];
    const scope = changeScope('pull_request', base, head, args => {
      calls.push(args);
      return args[0] === 'diff' ? diff : '';
    });
    assert.equal(scope.build_needed, expected, name);
    assert.deepEqual(calls, [
      ['fetch', '--depth=1', 'origin', base, head],
      ['diff', '--no-renames', '--name-only', '-z', base, head],
    ]);
  }
  for (const failAt of ['fetch', 'diff']) {
    const scope = changeScope('pull_request', base, head, args => {
      if (args[0] === failAt) throw new Error('git error / missing shallow base');
      return '';
    });
    assert.deepEqual(scope, { build_needed: true, files: [] });
  }
  assert.equal(changeScope('pull_request', '', head).build_needed, true);
  assert.equal(changeScope('push', base, head, () => {
    throw new Error('Production must not inspect paths');
  }).build_needed, true);
  console.log('SCOPE_SELF_CHECK_OK');
}

if (require.main === module) {
  if (process.argv.includes('--self-check')) {
    selfCheck();
  } else {
    const scope = changeScope(process.env.GITHUB_EVENT_NAME, process.env.BASE_SHA, process.env.HEAD_SHA);
    // Keep the existing test selector's newline input. Unknown scope means ALL.
    writeFileSync(path.join(process.env.RUNNER_TEMP, 'changed-files.txt'),
      scope.files.some(file => /[\r\n]/.test(file)) ? '' : scope.files.join('\n'));
    appendFileSync(process.env.GITHUB_OUTPUT, `build_needed=${scope.build_needed}\n`);
    console.log(scope.build_needed ? 'Run full CI (non-docs or unknown diff).' : 'Docs-only PR: heavy CI steps are not needed.');
  }
}
