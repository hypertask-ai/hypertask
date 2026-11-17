const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
function shouldStop(attempt, event, sha, live) {
  return Number(attempt) > 1 && (event === 'pull_request' || event === 'push') && live !== sha;
}
function liveHead(env, exec) {
  const repo = env.GITHUB_REPOSITORY;
  if (env.GITHUB_EVENT_NAME === 'pull_request') {
    const number = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')).pull_request?.number;
    if (!Number.isInteger(number)) return '';
    return exec(['api', `repos/${repo}/pulls/${number}`, '--jq', '.head.sha']).trim();
  }
  if (env.GITHUB_EVENT_NAME !== 'push' || !/^[\w./-]+$/.test(env.GITHUB_REF_NAME || '')) return '';
  return exec(['api', `repos/${repo}/commits/${env.GITHUB_REF_NAME}`, '--jq', '.sha']).trim();
}
function main(env = process.env, exec = (args) => execFileSync('gh', args, { encoding: 'utf8' })) {
  if (Number(env.GITHUB_RUN_ATTEMPT) <= 1) return 0;
  const live = liveHead(env, exec);
  if (!shouldStop(env.GITHUB_RUN_ATTEMPT, env.GITHUB_EVENT_NAME, env.GITHUB_SHA, live)) return 0;
  console.error(`stale rerun ${env.GITHUB_SHA} live ${live || '(unreadable)'}`);
  return 1;
}
module.exports = { shouldStop, main };
if (require.main === module) process.exit(main());
