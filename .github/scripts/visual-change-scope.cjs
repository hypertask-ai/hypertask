#!/usr/bin/env node
// Visual comparison scope (HYCI-10). The comparison moved from
// visual-regression.yml's pull_request paths filter into ci-tests.yml, which has no
// path filter of its own, so the same file list is decided here.
const { execFileSync } = require('node:child_process');
const { appendFileSync } = require('node:fs');

const INCLUDES = [
  'src/app/**',
  'src/components/**',
  'src/hooks/**',
  'src/styles/**',
  'styles/**',
  '**/*.css',
  'tailwind.config.*',
  'public/**',
  '.github/workflows/visual-regression.yml',
  '.github/workflows/ci-tests.yml',
  '.github/scripts/visual-change-scope.cjs',
  'e2e/visual/**',
  'scripts/seed-browser-smoke.mjs',
  'scripts/visual-regression-ci.mjs',
];
const EXCLUDES = ['src/app/api/**', '**/*.md'];

function globToRegExp(glob) {
  let source = '^';
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === '*') {
      if (glob[index + 1] !== '*') {
        source += '[^/]*';
        continue;
      }
      if (glob[index + 2] === '/') {
        source += '(?:[^/]+/)*';
        index += 2;
        continue;
      }
      source += '.*';
      index += 1;
      continue;
    }
    source += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${source}$`);
}

const MATCHERS = INCLUDES.map(globToRegExp);
const EXCLUDERS = EXCLUDES.map(globToRegExp);

function visualNeeded(files) {
  // An unreadable or empty diff must run the comparison, never skip it.
  if (!Array.isArray(files) || files.length === 0) return true;
  // A malformed list is an unknown diff: run the comparison.
  if (files.some(file => typeof file !== 'string' || file.length === 0 || /[\r\n]/.test(file))) return true;
  return files.some(file =>
    MATCHERS.some(matcher => matcher.test(file)) && !EXCLUDERS.some(matcher => matcher.test(file)));
}

// GitHub's pull_request paths filter compares the merge base, not the base tip:
// production commits that landed after the branch point are not this PR's changes.
const MERGE_BASE_DEPTHS = [50, 200, 1000];

function changedFiles(base, head, git = args => execFileSync('git', args, {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
})) {
  for (const depth of MERGE_BASE_DEPTHS) {
    let mergeBase = '';
    try {
      git(['fetch', '--depth=' + depth, 'origin', base, head]);
      mergeBase = String(git(['merge-base', base, head]) || '').trim();
    } catch {
      continue;
    }
    if (!/^[a-f0-9]{40}$/.test(mergeBase)) continue;
    try {
      const diff = git(['diff', '--no-renames', '--name-only', '-z', mergeBase, head]);
      if (!diff || !diff.endsWith('\0')) return [];
      return diff.slice(0, -1).split('\0');
    } catch {
      // An unreadable diff is an unknown diff: run the comparison.
      return [];
    }
  }
  return [];
}

function selfCheck() {
  const assert = require('node:assert/strict');
  for (const [name, files, expected] of [
    ['component', ['src/components/Board.tsx'], true],
    ['api route', ['src/app/api/tasks/route.ts'], false],
    ['app page', ['src/app/page.tsx'], true],
    ['stylesheet', ['src/styles/app.css'], true],
    ['nested stylesheet', ['e2e/theme/x.scss.css'], true],
    ['tailwind config', ['tailwind.config.ts'], true],
    ['public asset', ['public/logo.png'], true],
    ['markdown', ['src/components/readme.md'], false],
    ['visual harness', ['e2e/visual/board.spec.ts'], true],
    ['seed script', ['scripts/seed-browser-smoke.mjs'], true],
    ['the comparison workflow', ['.github/workflows/ci-tests.yml'], true],
    ['unrelated workflow', ['.github/workflows/app-smoke.yml'], false],
    ['unrelated source', ['src/lib/queue.ts'], false],
    ['mixed', ['src/lib/queue.ts', 'src/hooks/useBoard.ts'], true],
    ['empty', [], true],
    ['invalid entry', [''], true],
  ]) assert.equal(visualNeeded(files), expected, name);
  const base = 'a'.repeat(40);
  const head = 'b'.repeat(40);
  const mergeBase = 'c'.repeat(40);
  const git = diff => args => args[0] === 'diff' ? diff : `${mergeBase}\n`;
  assert.deepEqual(changedFiles(base, head, git('src/app/page.tsx\0')), ['src/app/page.tsx']);
  // A failed diff must run the comparison, not skip it.
  assert.deepEqual(changedFiles(base, head, () => { throw new Error('git failed'); }), []);
  assert.equal(visualNeeded(changedFiles(base, head, () => { throw new Error('git failed'); })), true);
  // A missing merge base in the shallow window deepens once before giving up.
  const calls = [];
  let mergeBaseCalls = 0;
  const deepened = changedFiles(base, head, args => {
    calls.push(args[0] === 'fetch' ? `${args[0]} ${args[1]}` : args[0]);
    if (args[0] !== 'merge-base') return args[0] === 'diff' ? 'src/components/x.tsx\0' : '';
    mergeBaseCalls += 1;
    if (mergeBaseCalls === 1) throw new Error('no merge base');
    return mergeBase;
  });
  assert.deepEqual(deepened, ['src/components/x.tsx']);
  assert.deepEqual(calls, ['fetch --depth=50', 'merge-base', 'fetch --depth=200', 'merge-base', 'diff']);
  console.log('VISUAL_SCOPE_SELF_CHECK_OK');
}

if (require.main === module) {
  if (process.argv.includes('--self-check')) {
    selfCheck();
  } else {
    const base = process.env.BASE_SHA;
    const head = process.env.HEAD_SHA;
    let needed = true;
    try {
      if (!/^[a-f0-9]{40}$/.test(base || '') || !/^[a-f0-9]{40}$/.test(head || '')) {
        throw new Error('Missing PR commit SHA');
      }
      needed = visualNeeded(changedFiles(base, head));
    } catch {
      needed = true;
    }
    appendFileSync(process.env.GITHUB_OUTPUT, `visual_needed=${needed}\n`);
    console.log(needed ? 'Visual comparison needed.' : 'No screen or harness file changed: visual comparison skipped.');
  }
}

module.exports = { visualNeeded, changedFiles, INCLUDES, EXCLUDES };
