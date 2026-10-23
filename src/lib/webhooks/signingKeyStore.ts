import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto'

const PREFIX = 'enc:v1:'
const VERSION = 1
const IV_LEN = 12
const TAG_LEN = 16
const HEADER_LEN = 1 + IV_LEN + TAG_LEN

function getKey(): Uint8Array {
  const secret = process.env.BYOK_CIPHER_SECRET
  if (!secret || secret.length < 16) {
    throw new Error('Webhook signing key encryption is unavailable')
  }
  return new Uint8Array(hkdfSync('sha256', secret, '', 'hypertask:webhook-signing-key:v1', 32))
}

export function sealWebhookSigningKey(plain: string): string {
  const iv = Uint8Array.from(randomBytes(IV_LEN))
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv, { authTagLength: TAG_LEN })
  const encrypted = Uint8Array.from(cipher.update(plain, 'utf8'))
  const final = Uint8Array.from(cipher.final())
  const tag = Uint8Array.from(cipher.getAuthTag())
  return PREFIX + Buffer.from([VERSION, ...iv, ...tag, ...encrypted, ...final]).toString('base64')
}

export function isSealedWebhookSigningKey(stored: string): boolean {
  return stored.startsWith(PREFIX)
}

export function openWebhookSigningKey(stored: string): string {
  if (!stored.startsWith('enc:')) return stored
  try {
    if (!isSealedWebhookSigningKey(stored)) throw new Error()
    const encoded = stored.slice(PREFIX.length)
    const raw = Buffer.from(encoded, 'base64')
    if (raw.length < HEADER_LEN || raw[0] !== VERSION || raw.toString('base64') !== encoded) {
      throw new Error()
    }
    const bytes = Uint8Array.from(raw)
    const decipher = createDecipheriv('aes-256-gcm', getKey(), bytes.subarray(1, 1 + IV_LEN), { authTagLength: TAG_LEN })
    decipher.setAuthTag(bytes.subarray(1 + IV_LEN, HEADER_LEN))
    const decrypted = Uint8Array.from(decipher.update(bytes.subarray(HEADER_LEN)))
    const final = Uint8Array.from(decipher.final())
    return Buffer.from([...decrypted, ...final]).toString('utf8')
  } catch {
    throw new Error('Webhook signing key is unavailable')
  }
}

export function webhookSigningKeyHint(stored: string): string {
  try {
    return `whsec_…${openWebhookSigningKey(stored).slice(-4)}`
  } catch {
    return 'unavailable'
  }
}
