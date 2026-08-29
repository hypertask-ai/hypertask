import crypto from 'crypto'

/** HMAC-SHA256 of the exact request body, hex, prefixed `sha256=`. Receivers
 *  recompute this with their shared secret to verify the call really came from
 *  us. Pure — no IO — so it stays trivially testable. */
export function signWebhookBody(secret: string, body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex')
}
