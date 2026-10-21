import { createHash, randomBytes } from 'crypto'

export function validatePKCE(codeVerifier: string, storedChallenge: string): boolean {
  if (!codeVerifier || !storedChallenge) {
    return false
  }

  const hash = createHash('sha256').update(codeVerifier).digest()
  
  const computed = hash.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  
  return computed === storedChallenge
}

export function generateAuthCode(): string {
  const randomBytesBuffer = randomBytes(32)
  
  return randomBytesBuffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}
