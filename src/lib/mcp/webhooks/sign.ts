import crypto from 'crypto'

export function signWebhookBody(secret: string, body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex')
}
