const TOKEN_PART_PATTERN = /^[A-Za-z0-9_-]+$/

type SessionPayload = {
  id: number
  email?: string
}

type SignedSessionPayload = SessionPayload & {
  iat: number
  exp: number
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> | null {
  if (!value || !TOKEN_PART_PATTERN.test(value) || value.length % 4 === 1) {
    return null
  }

  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

export async function verifySessionEdge(
  token: string | undefined
): Promise<SessionPayload | null> {
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

    const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET
    if (!secret) {
      return null
    }

    const textEncoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      textEncoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )

    const isValidSignature = await crypto.subtle.verify(
      'HMAC',
      key,
      signature,
      textEncoder.encode(encodedPayload)
    )

    if (!isValidSignature) {
      return null
    }

    const payloadBytes = base64UrlDecode(encodedPayload)
    if (!payloadBytes) {
      return null
    }

    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as SignedSessionPayload
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
