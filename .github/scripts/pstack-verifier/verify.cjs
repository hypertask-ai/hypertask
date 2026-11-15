'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ABSENT_PLAN_SECRETS, commentBody, checkConclusion, firstVerdict, publicNote, publishAllowed, verdictLine } = require('./verdict.cjs');
const { headPreview, previewFromStatuses, landingsAllowPass } = require('./preview.cjs');
const { driveTargets } = require('./routes.cjs');
const { gh, ghJson, flattenPages } = require('./gh.cjs');
const { askFamily, checkPlan, decideAppVerdict, decideCheckVerdict, judgePrompt, workflowHostsOk } = require('./model.cjs');
const BLOCKED_NOTES = {
  unreadable: 'The pull request could not be read, so nothing was driven.',
  fork: 'A fork head is not driven and its code is not executed.',
  base: 'The pull request does not target production, so it was not driven.',
  author: 'Author family is unknown. Commit messages need one Author-Family trailer, or a manual start must pass author_family. No verifier ran.',
  plan: `No other model family has a plan. Missing secret: ${ABSENT_PLAN_SECRETS.join(', ')}.`,
};
function row(verdict, notes, authorFamily, verifierFamily, driven, evidenceLinks) {
  return { verdict, notes, authorFamily, verifierFamily, driven, evidenceLinks };
}
function loadMaps(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'INDEX.md')
    .map(entry => ({ area: entry.name.replace(/\.md$/, ''), file: entry.name, body: fs.readFileSync(path.join(dir, entry.name), 'utf8') }));
}
function workflowTexts(repo, sha, files) {
  return files.map(file => {
    const encoded = file.split('/').map(encodeURIComponent).join('/');
    const body = ghJson(['api', `repos/${repo}/contents/${encoded}?ref=${sha}`]);
    if (body.encoding !== 'base64' || typeof body.content !== 'string') throw new Error('unreadable workflow');
    return { path: file, text: Buffer.from(body.content, 'base64').toString('utf8') };
  });
}
function statusPreview(repo, sha) {
  try {
    const status = ghJson(['api', `repos/${repo}/commits/${sha}/status`]);
    const deployments = flattenPages(ghJson(['api', `repos/${repo}/deployments?sha=${sha}&per_page=20`]));
    const deploymentStatuses = deployments.flatMap(item => {
      try { return ghJson(['api', `repos/${repo}/deployments/${item.id}/statuses`]); } catch { return []; }
    });
    return previewFromStatuses({ deploymentStatuses, commitStatuses: status.statuses });
  } catch { return null; }
}
function runDrive(request) {
  const env = { ...process.env };
  for (const name of ['OPENCODE_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'VERCEL_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN']) delete env[name];
  const driven = spawnSync(process.execPath, [path.join(__dirname, 'drive.cjs')], {
    input: JSON.stringify(request), encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024, env, cwd: os.tmpdir(),
  });
  if (!driven.stdout) return [];
  try { return JSON.parse(driven.stdout).observations ?? []; } catch { return []; }
}

async function decide(plan, io = {}) {
  const authorFamily = plan.authorFamily || 'unknown';
  if (plan.blocked && BLOCKED_NOTES[plan.blocked]) return row('FAIL', BLOCKED_NOTES[plan.blocked], authorFamily, null, ['none']);
  const eligible = plan.tryFamilies?.[0] || null;
  if (!eligible) return row('FAIL', BLOCKED_NOTES.plan, authorFamily, null, ['none']);
  if (plan.surface !== 'app') {
    const check = checkPlan(plan.paths);
    let hostsOk = true;
    if (check.kind === 'workflow') {
      try {
        hostsOk = workflowHostsOk(io.workflowTexts ? io.workflowTexts(check.files) : workflowTexts(plan.repo, plan.sha, check.files)).ok;
      } catch { return row('FAIL', 'The changed workflow file could not be read.', authorFamily, eligible, ['workflow']); }
    }
    const script = decideCheckVerdict({ kind: check.kind, hostsOk });
    return row(script.verdict, `${script.notes} Eligible verifier family: ${eligible}. No page was driven.`, authorFamily, eligible, [check.kind]);
  }
  const targets = driveTargets(plan.paths, io.maps || loadMaps(path.join(process.env.GITHUB_WORKSPACE || process.cwd(), '.claude/skills/verify-qa/reference/feature-map'))).filter(target => target.route);
  const driven = targets.map(target => `${target.area} ${target.route}`);
  if (!targets.length) return row('FAIL', 'No feature map area covers the changed files, so the app was not driven.', authorFamily, null, ['none']);
  if (!(io.email ?? process.env.QA_LOGIN_EMAIL) || !(io.password ?? process.env.QA_LOGIN_PASSWORD)) {
    return row('FAIL', 'QA_LOGIN_EMAIL or QA_LOGIN_PASSWORD is empty, so the app was not driven.', authorFamily, null, driven);
  }
  const lookedUp = await (io.headPreview || headPreview)(plan.sha);
  const headUrl = lookedUp.url || (io.statusPreview ? io.statusPreview() : statusPreview(plan.repo, plan.sha));
  if (!headUrl || !plan.parentUrl) return row('FAIL', lookedUp.reason || 'No head preview and no parent URL, so the app was not driven.', authorFamily, null, driven);
  const observations = (io.runDrive || runDrive)({ parentUrl: plan.parentUrl, headUrl, routes: [...new Set(targets.map(target => target.route))] });
  const prompt = judgePrompt({ paths: plan.paths, targets, observations, parent: plan.parentUrl, head: headUrl });
  const asked = landingsAllowPass(observations)
    ? await firstVerdict(plan.tryFamilies, family => (io.ask || askFamily)(family, prompt))
    : { family: null, verdict: null };
  const decided = decideAppVerdict({ modelVerdict: asked.verdict, observations });
  if (!asked.family && decided.verdict !== 'FAIL') return row('FAIL', 'The drive finished but no verifier plan answered.', authorFamily, null, driven, [headUrl, plan.parentUrl]);
  return row(decided.verdict, decided.notes, authorFamily, asked.family, driven, [headUrl, plan.parentUrl]);
}

function alreadyCommented(repo, number, line) {
  const comments = flattenPages(ghJson(['api', '--paginate', '--slurp', `repos/${repo}/issues/${number}/comments?per_page=100`]));
  return comments.some(comment => String(comment.body ?? '').startsWith(`${line}\n`) || comment.body === line);
}

function publish({ repo, number, sha, result, runUrl, ghImpl = gh, currentSha, commented }) {
  const fresh = currentSha ? currentSha() : ghJson(['api', `repos/${repo}/pulls/${number}`]).head.sha;
  if (!publishAllowed(sha, fresh)) return { posted: false, reason: 'stale' };
  const body = commentBody({ ...result, headSha: sha, evidenceLinks: [...(result.evidenceLinks ?? []), runUrl].filter(Boolean) });
  const line = verdictLine(result.verdict, sha);
  ghImpl(['api', '--method', 'POST', `repos/${repo}/check-runs`, '--input', '-'], JSON.stringify({
    name: 'pstack-verifier', head_sha: sha, status: 'completed', conclusion: checkConclusion(result.verdict),
    details_url: runUrl || undefined, output: { title: line, summary: publicNote(result.notes).slice(0, 65000) || line },
  }));
  if (!(commented ? commented(line) : alreadyCommented(repo, number, line))) {
    ghImpl(['api', '--method', 'POST', `repos/${repo}/issues/${number}/comments`, '-f', 'body=@-'], body);
  }
  return { posted: true, line };
}

async function main() {
  const planPath = process.env.PSTACK_PLAN;
  if (!planPath) { console.error('pstack-verifier: PSTACK_PLAN is required'); process.exit(64); }
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  if (!plan.go || !plan.post) { console.log(`pstack-verifier: skipped ${plan.blocked || 'no post'}`); return; }
  const result = await decide(plan);
  if (!plan.sha) { console.error('pstack-verifier: no head sha to publish'); process.exit(1); }
  const posted = publish({ repo: plan.repo, number: plan.number, sha: plan.sha, result, runUrl: process.env.RUN_URL || '' });
  console.log(posted.posted ? posted.line : `pstack-verifier: not posted (${posted.reason})`);
  if (!posted.posted && posted.reason !== 'stale') process.exit(1);
}

module.exports = { decide, publish, BLOCKED_NOTES, loadMaps, statusPreview };

if (require.main === module) {
  main().catch(error => { console.error(publicNote(error.message || 'verify failed')); process.exit(1); });
}
