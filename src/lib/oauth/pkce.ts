import { createHash, randomBytes } from 'crypto'

/**
 * Validates PKCE code verifier against stored code challenge
 * Uses S256 method: base64url(sha256(code_verifier))
 * 
 * @param codeVerifier - The code verifier string from the client
 * @param storedChallenge - The stored code challenge (base64url encoded SHA256 hash)
 * @returns true if the verifier matches the challenge, false otherwise
 */
export function validatePKCE(codeVerifier: string, storedChallenge: string): boolean {
  if (!codeVerifier || !storedChallenge) {
    return false
  }

  // Compute SHA256 hash of code verifier
  const hash = createHash('sha256').update(codeVerifier).digest()
  
  // Convert to base64url encoding
  const computed = hash.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  
  return computed === storedChallenge
}

/**
 * Generates a random authorization code (32 bytes, base64url encoded)
 * Used for OAuth authorization code flow
 * 
 * @returns A random 32-byte string encoded in base64url format (64 characters)
 */
export function generateAuthCode(): string {
  // Generate 32 random bytes
  const randomBytesBuffer = randomBytes(32)
  
  // Convert to base64url encoding
  return randomBytesBuffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}
