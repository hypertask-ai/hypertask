const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const workflowsDir = path.join(__dirname, '..', '.github', 'workflows');
const ownerApprovedExceptions = new Set(['parity-contract-trusted.yml']);

for (const file of fs.readdirSync(workflowsDir).filter(file => file.endsWith('.yml')).sort()) {
  const workflow = yaml.load(fs.readFileSync(path.join(workflowsDir, file), 'utf8'));
  if (ownerApprovedExceptions.has(file)) continue;

  for (const [jobId, job] of Object.entries(workflow.jobs)) {
    test(`${file}: ${jobId} has an explicit job timeout`, () => {
      assert.ok(
        Number.isInteger(job['timeout-minutes']) && job['timeout-minutes'] > 0,
        `.github/workflows/${file}: job "${jobId}" must set a positive job-level timeout-minutes; add timeout-minutes based on recent job durations to avoid GitHub's 360-minute default.`,
      );
    });
  }
}
