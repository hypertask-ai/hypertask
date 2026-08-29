// Assert-based demo because this repository has no Vitest setup.
// Run after installing dependencies: npx tsx src/lib/mcp/__tests__/rateLimitTier.test.ts
import assert from 'node:assert/strict'
import {
  classifyMcpRateLimitCount,
  resolveMcpRateLimit,
  type McpAuthContext,
} from '@/lib/mcp/auth'

const humanCtx: McpAuthContext = {
  user: {
    id: 6,
    email: 'human@example.com',
  },
  agentId: null,
}

function demo() {
  assert.equal(
    classifyMcpRateLimitCount(120),
    'allow',
    'the strict-tier boundary is allowed without resolving auth'
  )

  assert.equal(
    classifyMcpRateLimitCount(601),
    'block',
    'a count above the agent-tier boundary is blocked without resolving auth'
  )

  assert.equal(
    classifyMcpRateLimitCount(121),
    'resolve-tier',
    'the first count above the strict tier requires tier resolution'
  )

  assert.equal(
    classifyMcpRateLimitCount(600),
    'resolve-tier',
    'the agent-tier boundary still requires tier resolution'
  )

  const agentCtx: McpAuthContext = {
    user: {
      id: 6,
      email: 'agent-owner@example.com',
    },
    agentId: 'agent-123',
  }
  assert.equal(
    resolveMcpRateLimit(agentCtx, 'any-token-string'),
    600,
    'an authenticated agent JWT gets the agent tier'
  )

  assert.equal(
    resolveMcpRateLimit(humanCtx, 'htk_valid-api-key'),
    600,
    'an authenticated htk_ API key gets the agent tier'
  )

  assert.equal(
    resolveMcpRateLimit(null, 'htk_invalid-api-key'),
    120,
    'an invalid htk_-shaped token stays on the default tier'
  )

  assert.equal(
    resolveMcpRateLimit(humanCtx, 'human-jwt'),
    120,
    'an authenticated human JWT stays on the default tier'
  )

  assert.equal(
    resolveMcpRateLimit(null, 'garbage-token'),
    120,
    'an unauthenticated garbage token stays on the default tier'
  )

  const managementCtx: McpAuthContext = {
    user: {
      id: 6,
      email: 'admin@example.com',
    },
    agentId: null,
    management: {
      keyId: 'management-key-123',
      permissions: {
        data: ['read'],
      },
    },
  }
  assert.equal(
    resolveMcpRateLimit(managementCtx, 'htmk_valid-management-key'),
    120,
    'an authenticated htmk_ management key stays on the default tier'
  )
}

demo()
console.log('rateLimitTier.test.ts: all assertions passed')
