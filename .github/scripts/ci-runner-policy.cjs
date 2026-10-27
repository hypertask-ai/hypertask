const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const yaml = require('js-yaml');

function command(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`${program} read failed; runner policy was not verified`);
  return result.stdout;
}

const api = endpoint => JSON.parse(command('gh', ['api', endpoint]));
const git = args => command('git', args);

function workflowDigest(workflows) {
  return createHash('sha256').update(JSON.stringify(Object.entries(workflows).sort())).digest('hex');
}

function evaluate(repository, policy, workflows, read = api) {
  const repo = repository.full_name;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || typeof repository.private !== 'boolean' ||
      !['public', 'private', 'internal'].includes(repository.visibility) ||
      repository.private !== (repository.visibility !== 'public')) throw new Error('Invalid live repository visibility');
  if (!policy?.topology?.compute) throw new Error('Missing topology.compute in CI policy');
  const digest = workflowDigest(workflows);
  const jobs = [];
  for (const [file, source] of Object.entries(workflows)) {
    const workflow = yaml.load(source);
    if (!workflow?.jobs || typeof workflow.jobs !== 'object' || Array.isArray(workflow.jobs) || !Object.keys(workflow.jobs).length) {
      throw new Error(`${file}: missing workflow jobs`);
    }
    for (const [name, job] of Object.entries(workflow.jobs)) {
      if (typeof job?.uses === 'string' && !job['runs-on'] &&
          job.uses.startsWith('./') && Object.hasOwn(workflows, job.uses.slice(2))) continue;
      const runner = job?.['runs-on'];
      const labels = typeof runner === 'string' ? [runner] : runner;
      if (!Array.isArray(labels) || !labels.length || labels.some(label => typeof label !== 'string' || label.includes('${{'))) {
        throw new Error(`${file}/${name}: runner must use explicit static labels`);
      }
      jobs.push({ file, name, labels });
    }
  }
  if (!jobs.length) throw new Error('No runnable workflow jobs found');
  let approval = '';
  if (repository.private && jobs.some(job => !job.labels.includes('self-hosted'))) {
    const url = policy.runner_policy?.private_hosted_approval;
    const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull)\/\d+#issuecomment-(\d+)$/.exec(url ?? '');
    if (!match || match[1].toLowerCase() !== repo.toLowerCase()) throw new Error(`Private GitHub-hosted runners need Valentin approval for workflow digest ${digest}`);
    const comment = read(`repos/${repo}/issues/comments/${match[2]}`);
    if (comment.user?.id !== 3296316 || comment.user?.type !== 'User' || comment.html_url !== url ||
        !comment.created_at || comment.created_at !== comment.updated_at ||
        comment.body?.trim() !== `Approve GitHub-hosted runners for ${repo} with workflow digest ${digest}.`) {
      throw new Error(`Invalid Valentin approval for workflow digest ${digest}`);
    }
    approval = `; approved by ${comment.user.login} (3296316), ${url}, workflow digest ${digest}`;
  }
  for (const { file, name, labels } of jobs) {
    if (!repository.private && (policy.topology.compute !== 'github-hosted-ubuntu-latest' || labels.length !== 1 || labels[0] !== 'ubuntu-latest')) {
      throw new Error(`${file}/${name}: public app CI requires GitHub-hosted ubuntu-latest`);
    }
    if (repository.private && !labels.includes('self-hosted') &&
        (labels.length !== 1 || !/^(ubuntu|windows|macos)-[a-zA-Z0-9.-]+$/.test(labels[0]))) {
      throw new Error(`${file}/${name}: unrecognized hosted runner labels`);
    }
  }
  const host = repository.private ? 'self-hosted unless Valentin approves hosted workflows; hosted minutes may cost money; self-hosted infrastructure is not free' :
    'GitHub-hosted ubuntu-latest only; standard hosted minutes are free';
  return `${repo}: ${repository.visibility}; ${host}; ${jobs.length} jobs checked; workflow digest ${digest}${approval}`;
}

function run(repo, ref, policyPath = 'docs/ci-policy.yml') {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) throw new Error('Use --repo owner/name');
  const remote = git(['config', '--get', 'remote.origin.url']).trim();
  const remoteRepo = /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(remote)?.[1];
  if (remoteRepo?.toLowerCase() !== repo.toLowerCase()) throw new Error('Requested repo must match this checkout origin');
  const repository = api(`repos/${repo}`);
  if (repository.full_name?.toLowerCase() !== repo.toLowerCase()) throw new Error('Live repository identity mismatch');
  const revision = ref ?? git(['rev-parse', 'HEAD']).trim();
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Workflow ref must be a full commit SHA');
  const workflows = {};
  for (const entry of git(['ls-tree', '-rz', revision, '--', '.github/workflows']).split('\0').filter(Boolean)) {
    const match = /^(100644|100755) blob [a-f0-9]{40}\t(\.github\/workflows\/[\w.-]+\.ya?ml)$/.exec(entry);
    if (!/\.ya?ml$/.test(entry)) continue;
    if (!match) throw new Error('Workflow must be a regular top-level YAML file');
    workflows[match[2]] = git(['show', `${revision}:${match[2]}`]);
  }
  return evaluate(repository, yaml.load(readFileSync(policyPath, 'utf8')), workflows);
}

async function checkPullRequest({ pr, core }) {
  if (!Number.isSafeInteger(pr.number) || pr.number <= 0 || !/^[a-f0-9]{40}$/.test(pr.head?.sha ?? '')) throw new Error('Invalid PR identity');
  const env = { ...process.env };
  if (env.GH_TOKEN) {
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${env.GH_TOKEN}`).toString('base64')}`;
  }
  command('git', ['fetch', '--no-tags', '--depth=1', 'origin', `refs/pull/${pr.number}/head`], { env });
  if (git(['rev-parse', 'FETCH_HEAD']).trim() !== pr.head.sha) throw new Error('PR head changed during runner check');
  core.info(run(pr.base.repo.full_name, pr.head.sha));
}

module.exports = { evaluate, workflowDigest, run, checkPullRequest };
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    while (args.length) {
      const key = args.shift();
      if (!['--repo', '--ref', '--policy'].includes(key) || !args.length) throw new Error('Usage: node .github/scripts/ci-runner-policy.cjs --repo owner/name [--ref SHA] [--policy FILE]');
      options[key] = args.shift();
    }
    console.log(run(options['--repo'], options['--ref'], options['--policy']));
  } catch (error) {
    console.error(`CI runner policy: ${error.message}`);
    process.exitCode = 1;
  }
}
