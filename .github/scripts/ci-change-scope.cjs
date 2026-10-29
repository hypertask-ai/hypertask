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

// Smoke builds add no coverage for documentation, skills or unit-test-only edits.
// Correctness CI still runs changed tests using the stricter build_needed output.
function heavyNeeded(files) {
  return !Array.isArray(files) || files.length === 0 || files.some(file =>
    typeof file !== 'string' || file.length === 0 || file.startsWith('src/') ||
    !(file.startsWith('docs/') || file.startsWith('.claude/') || file.endsWith('.md') || file.startsWith('skills/') ||
      file.startsWith('.agents/skills/') || file.startsWith('tests/')));
}

function buildNeeded(files) {
  return !Array.isArray(files) || files.length === 0 || files.some(file =>
    typeof file !== 'string' || file.length === 0 || !isDocsOnlyFile(file));
}

// The PR event's base SHA is the CURRENT production tip, not where the branch
// started. Diffing that tip against head counts every commit production gained
// since the branch point as "changed", so a two-file skill PR ran full CI.
// Diff from the merge base instead (what GitHub's PR "Files" tab shows).
// Checkouts are shallow, so deepen until the merge base is visible; if it never
// is, fail closed and run everything.
const MERGE_BASE_DEPTHS = [50, 200, 1000];

function mergeBase(base, head, git) {
  for (const depth of MERGE_BASE_DEPTHS) {
    git(['fetch', `--depth=${depth}`, 'origin', base, head]);
    let out = '';
    try { out = git(['merge-base', base, head]); } catch { out = ''; }
    const sha = String(out || '').trim();
    if (/^[a-f0-9]{40}$/.test(sha)) return sha;
  }
  throw new Error('Merge base not found within fetch depth');
}

function changeScope(event, base, head, git = args => execFileSync('git', args, {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
})) {
  if (event !== 'pull_request') return { build_needed: true, files: [] };
  try {
    if (!/^[a-f0-9]{40}$/.test(base || '') || !/^[a-f0-9]{40}$/.test(head || '')) {
      throw new Error('Missing PR commit SHA');
    }
    const from = mergeBase(base, head, git);
    // Disable rename detection: moving source into docs must still run CI.
    const diff = git(['diff', '--no-renames', '--name-only', '-z', from, head]);
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
  for (const [files, expected] of [
    [['tests/unit.test.cjs'], false], [['skills/foo/SKILL.md'], false],
    [['nested/guide.md'], false], [['.agents/skills/a/script.sh'], false],
    [['src/app/wiki/agents/agents.md'], true], [['tests/a.cjs', 'src/a.ts'], true],
    [['package.json'], true], [[], true], [['.github/scripts/ci-change-scope.cjs'], true],
  ]) assert.equal(heavyNeeded(files), expected, files.join(', '));
  const base = 'a'.repeat(40);
  const head = 'b'.repeat(40);
  const fork = 'c'.repeat(40);
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
      if (args[0] === 'merge-base') return `${fork}\n`;
      return args[0] === 'diff' ? diff : '';
    });
    assert.equal(scope.build_needed, expected, name);
    assert.deepEqual(calls, [
      ['fetch', '--depth=50', 'origin', base, head],
      ['merge-base', base, head],
      ['diff', '--no-renames', '--name-only', '-z', fork, head],
    ]);
  }
  // Production moved after the branch point: its new src/ commits are in
  // base..head but not in merge-base..head. Only the PR's own files count.
  {
    const scope = changeScope('pull_request', base, head, args => {
      if (args[0] === 'merge-base') return fork;
      if (args[0] !== 'diff') return '';
      return args[4] === fork ? '.claude/skills/ship/scripts/ship-claim\0' : '.claude/x\0src/app/page.tsx\0';
    });
    assert.deepEqual(scope, { build_needed: false, files: ['.claude/skills/ship/scripts/ship-claim'] });
  }
  // Merge base outside the first shallow window: deepen, then diff from it.
  {
    const calls = [];
    let mergeBaseCalls = 0;
    const scope = changeScope('pull_request', base, head, args => {
      calls.push(args);
      if (args[0] === 'merge-base') {
        mergeBaseCalls += 1;
        if (mergeBaseCalls === 1) throw new Error('no merge base in shallow history');
        return fork;
      }
      return args[0] === 'diff' ? 'docs/a.md\0' : '';
    });
    assert.equal(scope.build_needed, false, 'deepened merge base');
    assert.deepEqual(calls.map(args => args.slice(0, 2)), [
      ['fetch', '--depth=50'], ['merge-base', base], ['fetch', '--depth=200'], ['merge-base', base],
      ['diff', '--no-renames'],
    ]);
  }
  // Merge base never found: fail closed (run everything), never diff the tip.
  {
    const calls = [];
    const scope = changeScope('pull_request', base, head, args => {
      calls.push(args);
      return args[0] === 'diff' ? 'docs/a.md\0' : '';
    });
    assert.deepEqual(scope, { build_needed: true, files: [] });
    assert.ok(!calls.some(args => args[0] === 'diff'), 'no diff without a merge base');
  }
  for (const failAt of ['fetch', 'merge-base', 'diff']) {
    const scope = changeScope('pull_request', base, head, args => {
      if (args[0] === failAt) throw new Error('git error / missing shallow base');
      return args[0] === 'merge-base' ? fork : '';
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
    const event = process.env.SCOPE_EVENT_NAME || process.env.GITHUB_EVENT_NAME;
    const scope = changeScope(event, process.env.BASE_SHA, process.env.HEAD_SHA);
    // Keep the existing test selector's newline input. Unknown scope means ALL.
    writeFileSync(path.join(process.env.RUNNER_TEMP, 'changed-files.txt'),
      scope.files.some(file => /[\r\n]/.test(file)) ? '' : scope.files.join('\n'));
    const heavy = event === 'pull_request' && scope.files.length ? heavyNeeded(scope.files) : true;
    appendFileSync(process.env.GITHUB_OUTPUT, `build_needed=${scope.build_needed}\nheavy_needed=${heavy}\n`);
    if (!heavy) console.log('docs-only change, skipped heavy smoke build (documentation/skills/tests only).');
    console.log(scope.build_needed ? 'Run full CI (non-docs or unknown diff).' : 'Docs-only PR: heavy CI steps are not needed.');
  }
}
