const test = require('node:test')
const assert = require('node:assert/strict')
const { access, readFile } = require('node:fs/promises')

// The review engine itself lives in hypertask-ai/reviewer. What stays
// here is the runner host contract: who may invoke the subscription wrappers,
// how the dispatch timer reaches the broker, and how auto-merge treats the
// review gate.

test('only the review-runner identity can invoke subscription wrappers', async () => {
  const sudoers = await readFile('.github/scripts/subscription-review/sudoers', 'utf8')
  assert.match(sudoers, /^htreviewrunner ALL=\(aireviewer\)/m)
  assert.doesNotMatch(sudoers, /^ghrunner ALL=\(aireviewer\)/m)
  assert.doesNotMatch(sudoers, /^ghrunner ALL=\(reviewdispatch\)/m)
})

test('subscription CLIs receive trusted policy through authoritative channels', async () => {
  const codexWrapper = await readFile('.github/scripts/subscription-review/codex-review', 'utf8')
  const claudeWrapper = await readFile('.github/scripts/subscription-review/claude-review', 'utf8')
  assert.match(codexWrapper, /model_instructions_file=/)
  assert.match(codexWrapper, /<"\$review_tmp\/context\.txt"/)
  assert.match(codexWrapper, /\.cache\/hypertask-review/)
  assert.match(claudeWrapper, /--system-prompt-file "\$review_tmp\/instructions\.txt"/)
  assert.match(claudeWrapper, /<"\$review_tmp\/context\.txt"/)
  assert.match(claudeWrapper, /\.cache\/hypertask-review/)
})

test('root-installed poller is the only automatic review dispatcher', async () => {
  await assert.rejects(access('.github/workflows/claude-review.yml'), { code: 'ENOENT' })
  await assert.rejects(access('.github/workflows/ai-review.yml'), { code: 'ENOENT' })
  await assert.rejects(access('.github/scripts/ai-review.mjs'), { code: 'ENOENT' })
  const installer = await readFile('.github/scripts/subscription-review/install-wrappers.sh', 'utf8')
  assert.match(installer, /-o root -g reviewdispatch -m 750 "\$source_dir\/dispatch-review"/)
  assert.match(installer, /-o root -g reviewdispatch -m 750 "\$source_dir\/dispatch-scan"/)
  assert.match(installer, /\/var\/lib\/hypertask-ai-review\/completed/)
  assert.match(installer, /\$source_dir\/claude-review" \/usr\/local\/libexec\/hypertask-claude-subscription-review/)
  assert.doesNotMatch(installer, /\/usr\/local\/bin\/hypertask-dispatch-review/)
  const scan = await readFile('.github/scripts/subscription-review/dispatch-scan', 'utf8')
  assert.match(scan, /\/usr\/local\/libexec\/hypertask-dispatch-review/)
  assert.match(scan, /draft == false/)
  assert.match(scan, /completed_dir\/\$head_sha/)
  const service = await readFile('.github/scripts/subscription-review/hypertask-ai-review-dispatch.service', 'utf8')
  assert.match(service, /^User=reviewdispatch$/m)
  const timer = await readFile('.github/scripts/subscription-review/hypertask-ai-review-dispatch.timer', 'utf8')
  assert.match(timer, /^OnUnitActiveSec=30s$/m)
  const broker = await readFile('.github/scripts/subscription-review/dispatch-review', 'utf8')
  assert.match(broker, /--config "\$curl_config"/)
  assert.doesNotMatch(broker, /Authorization: Bearer/)
  assert.match(broker, /Private review is still/)
  assert.match(broker, /workflow_runs\[\]/)
  assert.match(broker, /run_title="Review hypertasks PR #\$\{pr_number\} @ \$\{actual_sha\}"/)
  assert.match(broker, /select\(\.display_title == \$title\)/)
  assert.match(broker, /automatic_attempts.*-ge 2/)
  assert.match(broker, /commits\/\$\{actual_sha\}\/status/)
  assert.match(broker, /\.context == \"claude-review\"/)
  assert.match(broker, /completed_file/)
  assert.match(broker, /event=repository_dispatch/)
  assert.match(broker, /event_type:"review_pr",client_payload:/)
  assert.match(broker, /reviewer\/dispatches/)
  assert.doesNotMatch(broker, /workflow_dispatch/)
  assert.doesNotMatch(broker, /actions\/workflows\/review\.yml\/dispatches/)
  const autoMerge = await readFile('.github/workflows/automerge.yml', 'utf8')
  assert.doesNotMatch(autoMerge, /workflows: \[[^\n]*AI PR Review/)
  assert.match(autoMerge, /cron: "\*\/5 \* \* \* \*"/)
})

test('hax review wrapper reads the prompt from stdin and never as an argument (HTPR-7115)', async () => {
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  const { spawnSync } = require('node:child_process')
  const dir = '.github/scripts/subscription-review'
  const wrapper = await readFile(`${dir}/hax-review`, 'utf8')
  assert.doesNotMatch(wrapper, /\$\(cat\)/)
  assert.match(wrapper, /--raw -p\s*$/m)
  const installer = await readFile(`${dir}/install-wrappers.sh`, 'utf8')
  assert.match(installer, /-o root -g root -m 755 "\$source_dir\/hax-review" \/usr\/local\/libexec\/hypertask-hax-valentin-review/)
  assert.match(installer, /-o root -g root -m 755 "\$source_dir\/hax-entrypoint" \/usr\/local\/bin\/hypertask-hax-subscription-review/)

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hax-review-'))
  try {
    // The wrapper pins its own environment; neutralize those two lines in a copy only.
    const copy = path.join(tmp, 'wrapper')
    fs.writeFileSync(copy, wrapper.replace(/^export (HOME|PATH)=.*$/gm, ''), { mode: 0o755 })
    const bin = path.join(tmp, 'bin')
    fs.mkdirSync(bin)
    fs.writeFileSync(path.join(bin, 'hax'),
      '#!/usr/bin/env bash\nprintf "%s " "$@" >"$STUB_OUT/args"\nwc -c >"$STUB_OUT/stdin_bytes"\n', { mode: 0o755 })
    const input = Buffer.alloc(6 * 1024 * 1024, 'a')
    const res = spawnSync('bash', [copy], {
      input,
      maxBuffer: 64 * 1024 * 1024,
      env: { PATH: `${bin}:/usr/bin:/bin`, STUB_OUT: tmp },
    })
    assert.equal(res.status, 0, String(res.stderr))
    assert.equal(fs.readFileSync(path.join(tmp, 'stdin_bytes'), 'utf8').trim(), String(input.length))
    const args = fs.readFileSync(path.join(tmp, 'args'), 'utf8')
    assert.ok(args.length < 300)
    assert.doesNotMatch(args, /aaaa/)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
