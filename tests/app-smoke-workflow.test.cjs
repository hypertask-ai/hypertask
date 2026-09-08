const test = require('node:test')
const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')

test('app smoke validates the head before isolated build and route checks', async () => {
  const workflow = await readFile('.github/workflows/app-smoke.yml', 'utf8')
  const request = await readFile('.github/workflows/app-smoke-request.yml', 'utf8')

  assert.match(workflow, /name: run app-smoke/)
  assert.match(workflow, /timeout-minutes: 10/)
  assert.match(request, /branches: \[production\]/)
  assert.match(request, /types: \[opened, synchronize, reopened, ready_for_review, edited\]/)
  assert.match(workflow, /workflow_run:/)
  assert.match(workflow, /workflows: \["App Smoke Request"\]/)
  assert.match(workflow, /REQUEST_ACTOR/)
  assert.match(workflow, /\.head\.sha == \$sha/)
  assert.match(workflow, /runner='\["self-hosted","contabo"\]'/)
  assert.match(workflow, /runner='"ubuntu-latest"'/)
  assert.match(workflow, /container:\s+image: node:20-bookworm/)
  assert.match(workflow, /npx prisma migrate deploy/)
  assert.match(workflow, /node scripts\/seed-core-actions-smoke\.mjs/)
  assert.match(workflow, /npx next build --webpack/)
  assert.match(workflow, /node node_modules\/next\/dist\/bin\/next start -p 3100/)
  assert.match(workflow, /node scripts\/core-actions-smoke\.mjs/)
  assert.match(workflow, /repository: \$\{\{ needs\.validate\.outputs\.head-repository \}\}/)
  assert.match(workflow, /ref: \$\{\{ needs\.validate\.outputs\.head-sha \}\}/)
  assert.match(workflow, /persist-credentials: false/)
  assert.match(workflow, /-f context=app-smoke/)
  assert.match(workflow, /gh workflow run automerge\.yml .* -f pr="\$PR"/)
  assert.doesNotMatch(workflow, /actions\/cache\/save/)
  assert.doesNotMatch(workflow, /secrets\./)
})

test('auto-merge waits for app smoke and runs when it completes', async () => {
  const workflow = await readFile('.github/workflows/automerge.yml', 'utf8')

  assert.match(workflow, /workflows: \["CI Tests", "Revert Guard"\]/)
  assert.match(
    workflow,
    /REQUIRED="app-smoke ci-tests claude-review next-public-secrets revert-guard pr-title"/,
  )
})
