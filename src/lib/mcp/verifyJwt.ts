import jwt from 'jsonwebtoken';
import { JWT_LEGACY_OAUTH_AUDIENCE, JWT_OAUTH_AUDIENCE, JWT_OAUTH_ISSUER } from '@/lib/mcp/oauthTokenContract';

export const JWT_SECRET = process.env.JWT_SECRET as string

export const JWT_ISSUER = process.env.JWT_ISSUER || 'hypertask'

export const JWT_MCP_AUDIENCE = 'mcp-api'

export const JWT_LEGACY_MCP_AUDIENCE = 'hypertasks-mcp'

export const AGENT_TOKEN_GENERATION_CLAIM = 'agentTokenGeneration'

export function verifyMcpJwtToken(token: string): jwt.JwtPayload | null {
  if (!JWT_SECRET) {
    console.log('[MCP Auth] JWT_SECRET not configured')
    return null // JWT not configured
  }

  // First decode without verification to inspect token structure
  let decodedWithoutVerify: jwt.JwtPayload | null = null
  try {
    decodedWithoutVerify = jwt.decode(token, { complete: false }) as jwt.JwtPayload
    if (decodedWithoutVerify) {
      console.log('[MCP Auth] Token decoded (unverified):', {
        userId: decodedWithoutVerify.userId,
        sub: decodedWithoutVerify.sub,
        iss: decodedWithoutVerify.iss,
        aud: decodedWithoutVerify.aud,
        exp: decodedWithoutVerify.exp ? new Date(decodedWithoutVerify.exp * 1000).toISOString() : null,
        iat: decodedWithoutVerify.iat ? new Date(decodedWithoutVerify.iat * 1000).toISOString() : null
      })
    }
  } catch (err) {
    console.log('[MCP Auth] Failed to decode token:', err)
    return null
  }

  if (!decodedWithoutVerify) {
    console.log('[MCP Auth] Token decode returned null')
    return null
  }

  try {
    // Verify JWT token - try multiple audience/issuer combinations for compatibility
    let decoded: jwt.JwtPayload

    // Try current format first (mcp-api audience)
    try {
      decoded = jwt.verify(token, JWT_SECRET, {
        issuer: JWT_ISSUER,
        audience: JWT_MCP_AUDIENCE,
      }) as jwt.JwtPayload
      console.log('[MCP Auth] JWT verified with current format (mcp-api)')
    } catch (err: any) {
      console.log('[MCP Auth] Current format failed:', err?.message)
      // Try legacy format (hypertasks-mcp audience, hypertasks issuer)
      try {
        decoded = jwt.verify(token, JWT_SECRET, {
          issuer: 'hypertasks', // Legacy issuer
          audience: JWT_LEGACY_MCP_AUDIENCE,
        }) as jwt.JwtPayload
        console.log('[MCP Auth] JWT verified with legacy format (hypertasks-mcp)')
      } catch (err2: any) {
        console.log('[MCP Auth] Legacy format failed:', err2?.message)
        try {
          decoded = jwt.verify(token, JWT_SECRET, {
            issuer: JWT_OAUTH_ISSUER,
            audience: [JWT_OAUTH_AUDIENCE, JWT_LEGACY_OAUTH_AUDIENCE],
          }) as jwt.JwtPayload
          console.log('[MCP Auth] JWT verified as OAuth access token')
        } catch (errOAuth: any) {
          console.log('[MCP Auth] OAuth format failed:', errOAuth?.message)
          // Only tokens minted before MCP audiences were introduced may use the
          // compatibility path. A present audience belongs to another token contract.
          if (decodedWithoutVerify.aud !== undefined) {
            console.log('[MCP Auth] Token has an unsupported audience:', decodedWithoutVerify.aud)
            return null
          }
          try {
            decoded = jwt.verify(token, JWT_SECRET, {
              issuer: ['hypertasks', JWT_ISSUER, JWT_OAUTH_ISSUER],
            }) as jwt.JwtPayload
            console.log('[MCP Auth] Legacy audience-less JWT verified')
          } catch (err3: any) {
            console.log('[MCP Auth] All verification attempts failed')
            console.log('[MCP Auth] Signature error details:', err3?.message)
            console.log('[MCP Auth] JWT_SECRET exists:', !!JWT_SECRET, 'Length:', JWT_SECRET?.length)
            console.log('[MCP Auth] Token issuer:', decodedWithoutVerify?.iss, 'Expected:', ['hypertasks', JWT_ISSUER])
            console.log('[MCP Auth] Token audience:', decodedWithoutVerify?.aud, 'Expected:', [JWT_LEGACY_MCP_AUDIENCE, JWT_MCP_AUDIENCE])
            return null
          }
        }
      }
    }

    return decoded
  } catch {
    return null
  }
}

export function storedAgentTokenGeneration(
  agent: { mcpTokenJti: string | null } | null | undefined
): string | null {
  const generation = agent?.mcpTokenJti
  return typeof generation === 'string' && generation.length > 0
    ? generation
    : null
}

export function presentedAgentTokenGeneration(decoded: jwt.JwtPayload): string | null {
  const privateGeneration = decoded[AGENT_TOKEN_GENERATION_CLAIM]
  if (typeof privateGeneration === 'string' && privateGeneration.length > 0) {
    return privateGeneration
  }

  // Direct managed tokens predate the private OAuth claim; their own jti is
  // also their generation identifier.
  const directGeneration = decoded.jti ?? decoded.jwtid
  return typeof directGeneration === 'string' && directGeneration.length > 0
    ? directGeneration
    : null
}
