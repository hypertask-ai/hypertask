import { createHmac, timingSafeEqual } from 'crypto'

export const SESSION_COOKIE = 'ht_session'
export const SESSION_TTL_SECONDS = 600 * 60 * 24 * 7
const TOKEN_PART_PATTERN = /^[A-Za-z0-9_-]+$/

type SessionPayload = {
  id: number
  email?: string
}

type SignedSessionPayload = SessionPayload & {
  iat: number
  exp: number
}

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET
  if (!secret) {
    throw new Error('Missing SESSION_SECRET or JWT_SECRET env var')
  }
  return secret
}

function base64UrlEncode(value: Buffer | string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function base64UrlDecode(value: string): Buffer | null {
  if (!value || !TOKEN_PART_PATTERN.test(value) || value.length % 4 === 1) {
    return null
  }

  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  return Buffer.from(padded, 'base64')
}

function hmacSha256(value: string): Buffer {
  return createHmac('sha256', getSessionSecret()).update(value).digest()
}

export function signSession(
  payload: SessionPayload,
  ttlSeconds: number = SESSION_TTL_SECONDS
): string {
  const now = Math.floor(Date.now() / 1000)
  const signedPayload: SignedSessionPayload = {
    id: payload.id,
    ...(payload.email !== undefined ? { email: payload.email } : {}),
    iat: now,
    exp: now + ttlSeconds,
  }
  const encodedPayload = base64UrlEncode(JSON.stringify(signedPayload))
  const encodedSignature = base64UrlEncode(hmacSha256(encodedPayload))

  return `${encodedPayload}.${encodedSignature}`
}

export function verifySession(token: string | undefined): SessionPayload | null {
  try {
    if (!token) {
      return null
    }

    const tokenParts = token.split('.')
    if (tokenParts.length !== 2) {
      return null
    }

    const [encodedPayload, encodedSignature] = tokenParts
    const signature = base64UrlDecode(encodedSignature)
    if (!signature) {
      return null
    }

    const expectedSignature = hmacSha256(encodedPayload)
    if (
      signature.length !== expectedSignature.length ||
      !timingSafeEqual(signature, expectedSignature)
    ) {
      return null
    }

    const payloadBytes = base64UrlDecode(encodedPayload)
    if (!payloadBytes) {
      return null
    }

    const payload = JSON.parse(payloadBytes.toString('utf8')) as SignedSessionPayload
    if (
      typeof payload.id !== 'number' ||
      !Number.isFinite(payload.id) ||
      (payload.email !== undefined && typeof payload.email !== 'string') ||
      typeof payload.exp !== 'number' ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null
    }

    return {
      id: payload.id,
      ...(payload.email !== undefined ? { email: payload.email } : {}),
    }
  } catch {
    return null
  }
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  }
}

// Better Auth's session cookie is httpOnly, so a legacy login cannot clear it
// client-side. Left in place it belongs to the PREVIOUS user and the app keeps
// acting as them (HTPR-4170). Call this from every legacy login response; the
// bridge then mints a fresh Better Auth session for the new user.
export function clearBetterAuthSessionCookies(response: {
  cookies: { set: (name: string, value: string, options: Record<string, unknown>) => void }
}) {
  for (const name of ['__Secure-better-auth.session_token', 'better-auth.session_token']) {
    response.cookies.set(name, '', {
      httpOnly: true,
      secure: name.startsWith('__Secure-') || process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    })
  }
}
