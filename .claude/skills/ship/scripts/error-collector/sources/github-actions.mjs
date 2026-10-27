import { command } from '../io.mjs';

export const name = 'github-actions';
const repos = [['hypertask-ai/hypertask', 'production'], ['hypertask-ai/docs', 'main']];
const failed = run => ['failure', 'timed_out'].includes(run.conclusion);

export function parseRun(run, jobs, repo = 'hypertask-ai/hypertask') {
  if (!Array.isArray(jobs)) throw new Error('invalid GitHub jobs');
  const job = jobs.find(failed);
  return { service: name, board: 4060, unit: `${repo}/${run.workflowName}`, runId: String(run.databaseId), outcome: failed(run) ? 'failure' : 'success', userFacing: /^(Prod Health Check|Production Health)/i.test(run.workflowName), message: `${repo === 'hypertask-ai/docs' ? 'docs: ' : ''}${run.workflowName} ${failed(run) ? 'failed' : 'completed'}${job ? `: ${job.name}` : ''}`, route: '', stack: `https://github.com/${repo}/actions/runs/${run.databaseId}`, ts: run.updatedAt, count: 1 };
}

export async function fetch({ since, until, env }) {
  const runs = new Map();
  // GitHub caps workflow lifetime at 35 days; include older runs that finished in this window.
  for (const [repo, branch] of repos) {
    for (const scope of [['--branch', branch], ['--event', 'schedule']]) {
      const rows = JSON.parse(command('gh', ['run', 'list', '--repo', repo, ...scope, '--status', 'completed', '--created', `>=${new Date(Date.parse(since) - 35 * 86400000).toISOString()}`, '--limit', '10000', '--json', 'databaseId,createdAt,updatedAt,workflowName,event,conclusion,headBranch'], env));
      if (!Array.isArray(rows) || rows.length >= 10000) throw new Error('GitHub run list incomplete');
      for (const run of rows) if ((run.headBranch === branch || run.event === 'schedule') && Date.parse(run.updatedAt) > Date.parse(since) && Date.parse(run.updatedAt) <= Date.parse(until)) runs.set(`${repo}:${run.databaseId}`, { ...run, repo });
    }
  }
  let lookups = 0;
  return [...runs.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).map(run =>
    parseRun(run, failed(run) && lookups++ < 20 ? JSON.parse(command('gh', ['run', 'view', String(run.databaseId), '--repo', run.repo, '--json', 'jobs'], env)).jobs : [], run.repo));
}
