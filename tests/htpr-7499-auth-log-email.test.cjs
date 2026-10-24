const test = require('node:test')
const assert = require('node:assert/strict')
const jwt = require('jsonwebtoken')
const { load } = require('./task-route-loader.cjs')

const signingKey = 'htpr-7499-test-only-signing-key'
const payload = { userId: 985, sub: 'someone@example.com', email: 'someone@example.com', jti: 'test-token' }
process.env.JWT_SECRET = signingKey
process.env.JWT_ISSUER = 'hypertask'

for (const boundedLogging of [false, true]) {
  for (const shape of ['expired', 'unsigned', 'garbage-signature', 'valid']) {
    test(`${shape} token keeps email out of ${boundedLogging ? 'bounded' : 'normal'} auth logs`, (t) => {
      const { verifyMcpJwtToken } = load('src/lib/mcp/auth/verifyJwt.ts', {
        '@/lib/prisma': {},
        '@/utils/controllers/logs/createLog': {},
        '@prisma/client': {},
        '@/lib/flags': {},
        '@/lib/mcp/managementKeyTeamScope': {},
      })
      let token = jwt.sign(payload, shape === 'unsigned' ? null : signingKey, {
        algorithm: shape === 'unsigned' ? 'none' : 'HS256',
        issuer: 'hypertask',
        ...(shape === 'unsigned' || shape === 'garbage-signature' ? {} : { audience: 'mcp-api' }),
        expiresIn: shape === 'expired' ? -60 : '15m',
      })
      if (shape === 'garbage-signature') {
        token = `${token.split('.').slice(0, 2).join('.')}.${Buffer.from('garbage-signature').toString('base64url')}`
      }
      const logs = []
      t.mock.method(console, 'log', (...args) => logs.push(args))

      const result = verifyMcpJwtToken(token, { boundedLogging })

      if (shape === 'valid') assert.deepEqual(result, jwt.decode(token))
      else assert.equal(result, null)
      const decodedLogs = logs.filter(args => args[0] === '[MCP Auth] Token decoded (unverified):')
      assert.equal(decodedLogs.length, boundedLogging ? 0 : 1)
      for (const args of logs) {
        const line = JSON.stringify(args)
        assert.ok(!line.includes('@'))
        assert.ok(!line.includes('someone@example.com'))
      }
      if (!boundedLogging) assert.deepEqual(decodedLogs[0], ['[MCP Auth] Token decoded (unverified):', { userId: payload.userId }])
    })
  }
}
