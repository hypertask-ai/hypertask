import assert from 'node:assert/strict'
import test from 'node:test'
import crypto from 'crypto'
import { signWebhookBody } from '../../../../../src/lib/mcp/webhooks/sign'
import { assertSafeWebhookTarget, isPrivateIp } from '../../../../../src/lib/mcp/webhooks/ssrfGuard'

test('signWebhookBody produces an HMAC a receiver can independently recompute', () => {
  const secret = 'whsec_test'
  const body = JSON.stringify({ event: 'ping', data: { a: 1 } })

  const sig = signWebhookBody(secret, body)

  const expected =
    'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex')
  assert.equal(sig, expected)
})

test('signWebhookBody signs the timestamped string so a stale body cannot be replayed under a new timestamp', () => {
  const secret = 'whsec_test'
  const body = '{"x":1}'
  assert.notEqual(signWebhookBody(secret, `100.${body}`), signWebhookBody(secret, `200.${body}`))
})

test('signWebhookBody changes when the body changes (tamper detection)', () => {
  const secret = 'whsec_test'
  assert.notEqual(signWebhookBody(secret, '{"x":1}'), signWebhookBody(secret, '{"x":2}'))
})

test('signWebhookBody changes when the secret changes (wrong key cannot forge)', () => {
  const body = '{"x":1}'
  assert.notEqual(signWebhookBody('secretA', body), signWebhookBody('secretB', body))
})

test('isPrivateIp blocks every non-global range (byte/CIDR classification)', () => {
  const blocked = [
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.20.5.5',
    '192.168.1.1',
    '198.18.0.1',
    '198.51.100.7',
    '255.255.255.255',
    '::1',
    'fe80::1',
    'fe90::1',
    'febf::1',
    'fc00::1',
    'fd12::1',
    '::ffff:127.0.0.1',
    '64:ff9b::7f00:1',
  ]
  for (const ip of blocked) {
    assert.equal(isPrivateIp(ip), true, `expected ${ip} to be classified private`)
  }
})

test('isPrivateIp allows genuinely public addresses', () => {
  for (const ip of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isPrivateIp(ip), false, `expected ${ip} to be public`)
  }
})

test('assertSafeWebhookTarget rejects internal / non-https targets', async () => {
  const blocked = [
    'http://example.com/hook',
    'https://127.0.0.1/hook',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/hook',
    'https://localhost/hook',
    'https://db.internal/hook',
  ]
  for (const url of blocked) {
    const r = await assertSafeWebhookTarget(url)
    assert.equal(r.ok, false, `expected ${url} to be blocked`)
  }
})

test('assertSafeWebhookTarget allows a public IP literal over https', async () => {
  const r = await assertSafeWebhookTarget('https://1.1.1.1/hook')
  assert.equal(r.ok, true)
})
