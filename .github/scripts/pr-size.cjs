const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const policy = require('./pr-size-policy.json');

function countFiles(pr, files) {
  if (policy.mode !== 'report-only') throw new Error('Only report-only size policy is supported.');
  if (!Number.isSafeInteger(pr.changed_files) || pr.changed_files < 0 || files.length !== pr.changed_files) {
    throw new Error('Incomplete PR file list; no trustworthy size count.');
  }
  const excluded = filename => policy.excludedFiles.includes(filename) ||
    policy.excludedDirectories.some(directory => filename.startsWith(directory)) ||
    policy.excludedSuffixes.some(suffix => filename.endsWith(suffix));
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
    if (excluded(file.filename) && (!file.previous_filename || excluded(file.previous_filename))) ignored += lines;
    else counted += lines;
  }
  if (counted + ignored !== pr.additions + pr.deletions) {
    throw new Error('PR totals disagree with file counts; retry on a stable head.');
  }
  return { counted, ignored, total: counted + ignored, cap: policy.cap, wouldBlock: counted > policy.cap };
}

async function reportSize({ github, context, core, pr, prMetadata, reportDirectory = process.env.RUNNER_TEMP }) {
  const marker = '<!-- pr-size-warning -->';
  const report = { mode: 'report-only', runId: context.runId, runAttempt: context.runAttempt || 1, pr: pr?.number || context.payload?.pull_request?.number };
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
    const { data: current } = await github.rest.pulls.get({ ...context.repo, pull_number: pr.number });
    if (current.state !== 'open' || current.head.sha !== pr.head.sha) {
      report.verdict = 'stale';
      report.reason = 'PR closed or changed during measurement; no comment published.';
      core.info(report.reason);
      return report;
    }
    report.verdict = report.wouldBlock ? 'would-block' : 'within-cap';
    const body = [
      marker, '', '**PR size: report only.**',
      `- Hand-written changed lines: **${report.counted}**.`,
      `- Excluded generated and fixture lines: ${report.ignored}.`,
      `- Proposed cap: ${report.cap}.`,
      report.wouldBlock ? '- Above proposed cap; merging remains unchanged.' : '- Within the proposed cap.',
      '- Split into stacked PRs; each must build green.',
      '- size-ok approval not implemented; observation comes first.',
      '- Human exceptions need later safety review.',
    ].join('\n');
    summary = body;
    const comments = await github.paginate(github.rest.issues.listComments, {
      ...context.repo, issue_number: pr.number, per_page: 100,
    });
    const existing = comments.find(c => c.user?.login === 'github-actions[bot]' && c.body?.includes(marker));
    if (existing && existing.body !== body) {
      await github.rest.issues.updateComment({ ...context.repo, comment_id: existing.id, body });
    } else if (!existing && report.wouldBlock) {
      await github.rest.issues.createComment({ ...context.repo, issue_number: pr.number, body });
    }
    core.info(`PR #${pr.number}: ${report.verdict}; counted=${report.counted}, ignored=${report.ignored}, total=${report.total}`);
  } catch (error) {
    report.verdict = 'error';
    report.reason = error.message;
    core.warning(`PR size measurement unavailable (report only): ${error.message}`);
  } finally {
    if (reportDirectory) writeFileSync(join(reportDirectory, `pr-size-${context.runId}-${report.runAttempt}-${report.pr || 'unknown'}.json`), JSON.stringify(report, null, 2) + '\n');
    try {
      await core.summary.addRaw(`**Measurement result: ${report.verdict}.**\n\nHead: ${report.sha || 'unavailable'}\n\nTotal lines: ${report.total ?? 'unavailable'}\n\n${summary || report.reason}`).write();
    } catch (error) {
      core.warning(`Size summary unavailable: ${error.message}`);
    }
  }
  return report;
}

module.exports = reportSize;
module.exports.countFiles = countFiles;
