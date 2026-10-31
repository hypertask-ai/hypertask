const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const policy = require('./pr-size-policy.json');

const SPLIT = 'Split it into smaller changes that each build green.';
const REASON = /^[ \t]*size-ok:[ \t]*(\S.*)$/im;
const bot = user => user?.type === 'Bot' || /\[bot\]$/i.test(String(user?.login ?? ''));
const dependabot = pr => /^dependabot/i.test(String(pr.user?.login ?? ''));
const agent = pr => bot(pr.user) && !dependabot(pr);
const human = user => Boolean(user?.login) && !bot(user);

const excluded = filename => policy.excludedFiles.includes(filename) ||
  policy.excludedDirectories.some(directory => filename.startsWith(directory)) ||
  policy.excludedSuffixes.some(suffix => filename.endsWith(suffix));

const ignoredFile = file => excluded(file.filename) &&
  (!file.previous_filename || excluded(file.previous_filename));

function countChangedFiles(files) {
  let counted = 0;
  let ignored = 0;
  for (const file of files) {
    if (typeof file.filename !== 'string' || ![file.additions, file.deletions].every(n => Number.isSafeInteger(n) && n >= 0)) {
      throw new Error('Invalid PR file counts; no trustworthy size count.');
    }
    if (file.status === 'renamed' && (typeof file.previous_filename !== 'string' || !file.previous_filename)) {
      throw new Error('Missing original rename path; no trustworthy size count.');
    }
    const lines = file.additions + file.deletions;
    if (ignoredFile(file)) ignored += lines;
    else counted += lines;
  }
  return { counted, ignored, overCap: counted > policy.cap };
}

function countFiles(pr, files) {
  if (!Number.isSafeInteger(pr.changed_files) || pr.changed_files < 0 || files.length !== pr.changed_files) {
    throw new Error('Incomplete PR file list; no trustworthy size count.');
  }
  const { counted, ignored, overCap } = countChangedFiles(files);
  if (counted + ignored !== pr.additions + pr.deletions) {
    throw new Error('PR totals disagree with file counts; retry on a stable head.');
  }
  return { counted, ignored, total: counted + ignored, cap: policy.cap, overCap };
}

function exceptionFor(pr, comments) {
  if (!(pr.labels ?? []).some(label => label.name === policy.exceptionLabel)) {
    return { allowed: false, missing: 'label' };
  }
  const approved = [...comments].reverse().find(comment => human(comment.user) && REASON.test(comment.body ?? ''));
  if (!approved) return { allowed: false, missing: 'reason' };
  return { allowed: true, by: approved.user.login, reason: REASON.exec(approved.body)[1].trim() };
}

async function reportSize({ github, context, core, pr, prMetadata, reportDirectory = process.env.RUNNER_TEMP, now = Date.now() }) {
  const marker = '<!-- pr-size-warning -->';
  const enforcing = now >= Date.parse(policy.blockFrom);
  const report = {
    runId: context.runId,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || context.runAttempt || 1,
    phase: enforcing ? 'blocking' : 'observation',
    pr: pr?.number || context.payload?.pull_request?.number,
  };
  let summary = '';
  try {
    if (!pr && prMetadata) pr = JSON.parse(prMetadata);
    if (!pr) throw new Error('Missing trusted PR metadata.');
    Object.assign(report, { pr: pr.number, sha: pr.head.sha });
    core.setOutput('sha', pr.head.sha);
    if (pr.head.repo?.full_name !== `${context.repo.owner}/${context.repo.repo}`) {
      report.verdict = 'skipped';
      report.reason = 'Fork PR; outside-pr-guard owns this decision.';
      core.info(report.reason);
      return report;
    }
    const files = await github.paginate(github.rest.pulls.listFiles, {
      ...context.repo, pull_number: pr.number, per_page: 100,
    });
    Object.assign(report, countFiles(pr, files));
    report.agent = agent(pr);
    const { data: current } = await github.rest.pulls.get({ ...context.repo, pull_number: pr.number });
    if (current.state !== 'open' || current.head.sha !== pr.head.sha) {
      report.verdict = 'stale';
      report.reason = 'PR closed or changed during measurement; no comment published.';
      core.info(report.reason);
      return report;
    }
    const sizeComments = await github.paginate(github.rest.issues.listComments, {
      ...context.repo, issue_number: pr.number, per_page: 100,
    });
    const exception = report.overCap && report.agent ? exceptionFor(pr, sizeComments) : { allowed: false };
    report.exception = exception.allowed ? { by: exception.by, reason: exception.reason } : { missing: exception.missing };
    const blocked = Boolean(report.overCap && report.agent && enforcing && !exception.allowed);
    report.verdict = blocked ? 'blocked' : report.overCap ? 'would-block' : 'within-cap';
    report.enforcing = enforcing;
    const heading = blocked ? '**PR size: blocked.**'
      : !report.overCap ? '**PR size: within the cap.**'
        : report.agent ? `**PR size: over the cap. Blocking starts ${policy.blockFrom}.**`
          : '**PR size: over the cap. Human-authored changes are never blocked.**';
    const lines = `**${report.counted}** hand-written lines (cap ${policy.cap}); ${report.ignored} generated or fixture lines skipped.`;
    const next = blocked ? SPLIT
      : !report.overCap ? 'Nothing to split.'
        : report.agent ? 'Would be blocked once blocking starts.'
          : 'Not blocked: a human opened this change.';
    const body = [
      marker, '',
      heading,
      `- Hand-written changed lines: ${lines}`,
      `- ${next}`,
      report.overCap ? `- A human allows it with the ${policy.exceptionLabel} label and a "${policy.exceptionLabel}: <reason>" comment.` : '- No exception needed.',
      exception.allowed ? `- Allowed by ${exception.by}: ${exception.reason}` : '',
    ].filter(Boolean).join('\n');
    summary = body;
    const existing = sizeComments.find(c => c.user?.login === 'github-actions[bot]' && c.body?.includes(marker));
    if (existing && existing.body !== body) {
      await github.rest.issues.updateComment({ ...context.repo, comment_id: existing.id, body });
    } else if (!existing && (blocked || report.overCap)) {
      await github.rest.issues.createComment({ ...context.repo, issue_number: pr.number, body });
    }
    core.setOutput('blocked', blocked ? 'true' : 'false');
    if (blocked) {
      core.setFailed(
        `PR size: ${report.counted} hand-written lines is over the ${policy.cap}-line cap. ${SPLIT} ` +
        `A human allows it with the ${policy.exceptionLabel} label and a "${policy.exceptionLabel}: <reason>" comment.`,
      );
    }
    core.info(`PR #${pr.number}: ${report.verdict} in ${report.phase}; counted=${report.counted}, ignored=${report.ignored}`);
  } catch (error) {
    report.verdict = 'error';
    report.reason = error.message;
    core.warning(`PR size measurement unavailable; merging stays unchanged: ${error.message}`);
  } finally {
    if (reportDirectory) writeFileSync(join(reportDirectory, `pr-size-${context.runId}-${report.runAttempt}-${report.pr || 'unknown'}.json`), JSON.stringify(report, null, 2) + '\n');
    try {
      await core.summary.addRaw(`**Measurement result: ${report.verdict}** (${report.phase}).\n\nHead: ${report.sha || 'unavailable'}\n\nTotal lines: ${report.total ?? 'unavailable'}\n\n${summary || report.reason}`).write();
    } catch (error) {
      core.warning(`Size summary unavailable: ${error.message}`);
    }
  }
  return report;
}

module.exports = reportSize;
module.exports.countFiles = countFiles;
module.exports.countChangedFiles = countChangedFiles;
module.exports.exceptionFor = exceptionFor;
module.exports.isAgent = agent;
module.exports.SPLIT = SPLIT;
