const { execFileSync } = require('node:child_process');

function canSkipBuild(from, to, allowEmpty) {
  if (![from, to].every(sha => /^[a-f0-9]{40}$/.test(sha || ''))) return false;
  const git = args => execFileSync('git', args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000,
  });
  try {
    git(['merge-base', '--is-ancestor', from, to]);
    const diff = git(['diff', '--no-renames', '--name-only', '-z', from, to]);
    if (!diff) return allowEmpty;
    if (!diff.endsWith('\0')) return false;
    return diff.slice(0, -1).split('\0').every(file =>
      /^(docs|\.claude|\.agents\/skills|skills|tests|e2e|\.github)\//.test(file) ||
      (!file.includes('/') && file.endsWith('.md')));
  } catch {
    return false;
  }
}

const [from, to] = process.argv[2] === '--between'
  ? process.argv.slice(3)
  : [process.env.VERCEL_GIT_PREVIOUS_SHA, process.env.VERCEL_GIT_COMMIT_SHA];
const skip = canSkipBuild(from, to, process.argv[2] === '--between');
console.log(skip ? 'Skip build: only docs, skills, CI or tests changed.'
  : 'Build required: app inputs changed or deployment comparison is unknown.');
process.exitCode = skip ? 0 : 1;
