const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
function shouldStop(attempt, event, sha, live) {
  return Number(attempt) > 1 && (event === 'pull_request' || event === 'push') && live !== sha;
}
function eventPullRequest(env) {
  return JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')).pull_request;
}
function liveHead(env, exec) {
  const repo = env.GITHUB_REPOSITORY;
  if (env.GITHUB_EVENT_NAME === 'pull_request') {
    const number = eventPullRequest(env)?.number;
    if (!Number.isInteger(number)) return '';
    return exec(['api', `repos/${repo}/pulls/${number}`, '--jq', '.head.sha']).trim();
  }
  if (env.GITHUB_EVENT_NAME !== 'push' || !/^[\w./-]+$/.test(env.GITHUB_REF_NAME || '')) return '';
  return exec(['api', `repos/${repo}/commits/${env.GITHUB_REF_NAME}`, '--jq', '.sha']).trim();
}
function runCommit(env) {
  if (env.GITHUB_EVENT_NAME !== 'pull_request') return env.GITHUB_SHA;
  return eventPullRequest(env)?.head?.sha || '';
}
function main(env = process.env, exec = (args) => execFileSync('gh', args, { encoding: 'utf8' })) {
  if (Number(env.GITHUB_RUN_ATTEMPT) <= 1) return 0;
  const live = liveHead(env, exec);
  const built = runCommit(env);
  if (!shouldStop(env.GITHUB_RUN_ATTEMPT, env.GITHUB_EVENT_NAME, built, live)) return 0;
  console.error(`stale rerun ${built} live ${live || '(unreadable)'}`);
  return 1;
}
module.exports = { shouldStop, main };
if (require.main === module) process.exit(main());
