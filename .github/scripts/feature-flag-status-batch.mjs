import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { GithubRateLimit } from './github-rate-limit.mjs';

const QUERY = `query($owner:String!,$name:String!,$cursor:String) {
  repository(owner:$owner, name:$name) {
    pullRequests(states:OPEN, baseRefName:"production", first:100, after:$cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        headRefOid
        commits(last:1) {
          nodes { commit { oid status { contexts { context state description targetUrl createdAt } } } }
        }
      }
    }
  }
}`;

export function parseGhBody(stdout) {
  return String(stdout || '').replace(/^(?:HTTP\/[\d.]+[^\n]*\r?\n(?:[^\n]*\r?\n)*\r?\n)/, '');
}

export function isRateLimit(stdout, stderr) {
  return /rate limit/i.test(`${stdout || ''}\n${stderr || ''}`);
}

export function statusesFromGraphql(payload) {
  const connection = payload?.data?.repository?.pullRequests;
  if (!Array.isArray(connection?.nodes)) throw new Error('GitHub status batch returned no pull requests');
  const map = {};
  for (const pr of connection.nodes) {
    if (!pr) continue;
    const commit = pr.commits?.nodes?.[0]?.commit;
    const sha = commit?.oid || pr.headRefOid;
    if (!/^[0-9a-f]{40}$/.test(sha || '') || Object.hasOwn(map, sha)) continue;
    const contexts = commit?.status?.contexts ?? [];
    map[sha] = contexts.map((item) => ({
      context: item?.context,
      state: String(item?.state || '').toLowerCase(),
      description: item?.description ?? null,
      target_url: item?.targetUrl ?? null,
      updated_at: item?.createdAt ?? null,
    }));
  }
  return { map, pageInfo: connection.pageInfo || {} };
}

export function runStatusBatch({
  exec = spawnSync,
  env = process.env,
  repository = env.REPO || env.GITHUB_REPOSITORY,
} = {}) {
  const parts = String(repository || '').split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { exitCode: 1, error: 'Missing repository for the feature-flag status batch' };
  }
  const [owner, name] = parts;
  const map = {};
  let cursor = null;
  for (let page = 0; page < 10; page++) {
    const args = ['api', 'graphql', '-f', `query=${QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`];
    if (cursor) args.push('-f', `cursor=${cursor}`);
    const response = exec('gh', args, {
      encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024, env,
    });
    const stdout = response.stdout || '';
    const stderr = response.stderr || '';
    if (response.status !== 0) {
      if (isRateLimit(stdout, stderr)) {
        const reset = /x-ratelimit-reset:\s*(\d+)/i.exec(`${stdout}\n${stderr}`)?.[1];
        const until = reset ? new Date(reset * 1000).toISOString() : new Date(Date.now() + 60000).toISOString();
        return { exitCode: 78, warning: new GithubRateLimit(until).message };
      }
      const detail = (stderr || stdout || 'GitHub status batch failed').trim().split('\n').pop();
      return { exitCode: 1, error: detail };
    }
    let payload;
    try {
      payload = JSON.parse(parseGhBody(stdout));
    } catch {
      return { exitCode: 1, error: 'GitHub status batch returned malformed JSON' };
    }
    if (payload.errors) return { exitCode: 1, error: 'GitHub status batch returned errors' };
    let pageResult;
    try {
      pageResult = statusesFromGraphql(payload);
    } catch (error) {
      return { exitCode: 1, error: error.message };
    }
    Object.assign(map, pageResult.map);
    if (!pageResult.pageInfo.hasNextPage) return { exitCode: 0, map };
    cursor = pageResult.pageInfo.endCursor;
    if (!cursor) return { exitCode: 1, error: 'GitHub status batch omitted a page cursor' };
  }
  return { exitCode: 1, error: 'GitHub status batch exceeded 10 pages' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runStatusBatch({ repository: process.argv[2] });
  if (result.warning) console.error(`::warning::${result.warning}`);
  if (result.error) console.error(`::warning::${result.error}`);
  if (result.exitCode === 0) process.stdout.write(JSON.stringify(result.map));
  process.exit(result.exitCode);
}
