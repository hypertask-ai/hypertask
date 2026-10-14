import { command } from '../io.mjs';

export const name = 'github-actions';
const REPO = 'hypertask-ai/hypertask';
const failed = run => ['failure', 'timed_out'].includes(run.conclusion);

export function parseRun(run, jobs) {
  if (!Array.isArray(jobs)) throw new Error('invalid GitHub jobs');
  const job = jobs.find(failed);
  return { service: name, board: 4060, message: `${run.workflowName} failed: ${job?.name ?? 'unknown failing job'}`, route: '', stack: `https://github.com/${REPO}/actions/runs/${run.databaseId}`, ts: run.updatedAt, count: 1 };
}

export async function fetch({ since, until, env }) {
  const runs = new Map();
  // GitHub caps workflow lifetime at 35 days; include older runs that finished in this window.
  for (const scope of [['--branch', 'production'], ['--event', 'schedule']]) {
    for (const status of ['failure', 'timed_out']) {
      const rows = JSON.parse(command('gh', ['run', 'list', '--repo', REPO, ...scope, '--status', status, '--created', `>=${new Date(Date.parse(since) - 35 * 86400000).toISOString()}`, '--limit', '10000', '--json', 'databaseId,createdAt,updatedAt,workflowName,event,conclusion,headBranch'], env));
      if (!Array.isArray(rows) || rows.length >= 10000) throw new Error('GitHub run list incomplete');
      for (const run of rows) if (failed(run) && (run.headBranch === 'production' || run.event === 'schedule') && Date.parse(run.updatedAt) > Date.parse(since) && Date.parse(run.updatedAt) <= Date.parse(until)) runs.set(run.databaseId, run);
    }
  }
  if (runs.size > 20) throw new Error('GitHub job lookup budget exceeded');
  return [...runs.values()].map(run => parseRun(run, JSON.parse(command('gh', ['run', 'view', String(run.databaseId), '--repo', REPO, '--json', 'jobs'], env)).jobs));
}
