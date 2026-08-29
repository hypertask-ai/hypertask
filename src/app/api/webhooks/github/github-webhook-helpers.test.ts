// Assert-based demo because this repository has no Vitest setup.
// Run after installing dependencies: npx tsx src/app/api/webhooks/github/github-webhook-helpers.test.ts
import assert from 'node:assert/strict'
import { chooseReviewSectionName } from '@/app/api/webhooks/github/github-webhook-helpers'

function demo() {
  assert.equal(chooseReviewSectionName('High'), 'Valentin Review')
  assert.equal(chooseReviewSectionName('Medium'), 'AI Review')
  assert.equal(chooseReviewSectionName('Low'), 'AI Review')
  assert.equal(chooseReviewSectionName(null), 'AI Review')
  assert.equal(chooseReviewSectionName(undefined), 'AI Review')
}

demo()
console.log('github-webhook-helpers.test.ts: all assertions passed')
