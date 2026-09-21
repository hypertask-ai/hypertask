import { MCP_TOKEN_ISSUED_AT_MS_CLAIM, scopedTokenRevocationJti } from "./mcpAuthErrors";
import { AGENT_TOKEN_GENERATION_CLAIM, JWT_ISSUER, JWT_MCP_AUDIENCE, JWT_SECRET } from "./verifyJwt";
import prisma from '@/lib/prisma';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { JWT_OAUTH_AUDIENCE, JWT_OAUTH_ISSUER, OAUTH_CLIENT_ID_CLAIM } from '@/lib/mcp/oauthTokenContract';

export const AGENT_TEAM_ID_CLAIM = 'agentTeamId'

export const AGENT_TEAM_ACCESS_BINDING_CLAIM = 'agentTeamAccessBinding'

export type AgentTokenTeamScope = {
  teamId: string
  accessBinding: string
}

export function createMcpToken(
  userId: number,
  email: string,
  expiresIn: string | number = '30d',
  agentId?: string,
  agentTeamScope?: AgentTokenTeamScope
): string {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET not configured')
  }

  const jti = randomUUID()
  const issuedAt = Date.now()

  const payload: Record<string, unknown> = {
    sub: email,
    userId,
    jti,
    iat: Math.floor(issuedAt / 1000),
    [MCP_TOKEN_ISSUED_AT_MS_CLAIM]: issuedAt,
  }
  if (agentId) payload.agentId = agentId
  if (agentTeamScope) {
    if (!agentId) {
      throw new Error('A team-bound token requires an agent id')
    }
    if (!agentTeamScope.teamId || !agentTeamScope.accessBinding) {
      throw new Error('A team-bound token requires a complete team scope')
    }
    payload[AGENT_TEAM_ID_CLAIM] = agentTeamScope.teamId
    payload[AGENT_TEAM_ACCESS_BINDING_CLAIM] = agentTeamScope.accessBinding
  }

  // If agentId is specified, generate a token *without* expiry (no expiresIn)
  const signOptions: jwt.SignOptions = {
    issuer: JWT_ISSUER,
    audience: JWT_MCP_AUDIENCE,
    ...(agentId ? {} : { expiresIn: expiresIn as any }),
  }

  return jwt.sign(payload as jwt.JwtPayload, JWT_SECRET, signOptions)
}

export const MCP_OAUTH_TOKEN_EXPIRY = 90 * 24 * 60 * 60;

export function createOAuthToken(
  firebaseUid: string,
  userId: number,
  email: string,
  clientId: string,
  expiresIn: number = MCP_OAUTH_TOKEN_EXPIRY,
  agentId?: string | null,
  agentTokenJti?: string | null,
  agentTeamScope?: AgentTokenTeamScope
): string {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET not configured')
  }
  if (!clientId || clientId.length > 64) {
    throw new Error('OAuth tokens require a valid client id')
  }

  const oauthIssuer = JWT_OAUTH_ISSUER
  const oauthAudience = JWT_OAUTH_AUDIENCE

  // Don't include 'iss' and 'aud' in payload - jwt.sign() will add them via options
  const issuedAt = Date.now()
  const payload: Record<string, unknown> = {
    sub: firebaseUid,
    userId: userId,
    email: email,
    [OAUTH_CLIENT_ID_CLAIM]: clientId,
    jti: randomUUID(),
    iat: Math.floor(issuedAt / 1000),
    [MCP_TOKEN_ISSUED_AT_MS_CLAIM]: issuedAt,
  }
  if (agentId) {
    if (!agentTokenJti) {
      throw new Error('Agent OAuth tokens require the current agent token jti')
    }
    payload.agentId = agentId
    // Every OAuth credential keeps a unique jti. A separate private claim ties
    // it to the managed agent's revocable generation.
    payload[AGENT_TOKEN_GENERATION_CLAIM] = agentTokenJti
  }
  if (agentTeamScope) {
    if (!agentId) {
      throw new Error('A team-bound OAuth token requires an agent id')
    }
    if (!agentTeamScope.teamId || !agentTeamScope.accessBinding) {
      throw new Error('A team-bound OAuth token requires a complete team scope')
    }
    payload[AGENT_TEAM_ID_CLAIM] = agentTeamScope.teamId
    payload[AGENT_TEAM_ACCESS_BINDING_CLAIM] = agentTeamScope.accessBinding
  }

  return jwt.sign(payload as jwt.JwtPayload, JWT_SECRET, {
    issuer: oauthIssuer,
    audience: oauthAudience,
    ...(agentId ? {} : { expiresIn }),
  } as jwt.SignOptions)
}

export async function revokeTokenByJti(jti: string, userId: number, expiresAt: Date): Promise<void> {
  try {
    await prisma.revokedToken.upsert({
      where: { jti },
      create: {
        jti,
        user_id: userId,
        revoked_at: new Date(),
        expires_at: expiresAt,
      },
      update: {
        revoked_at: new Date(), // Update if already exists
      },
    })
  } catch (error) {
    console.error('[MCP Auth] Error revoking token:', error)
    throw error
  }
}

export async function claimTokenRotation(
  jti: string,
  userId: number,
  expiresAt: Date
): Promise<boolean> {
  try {
    await prisma.revokedToken.create({
      data: {
        jti,
        user_id: userId,
        revoked_at: new Date(),
        expires_at: expiresAt,
      },
    })
    return true
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return false
    }
    throw error
  }
}

export async function revokeOwnedTokenByJti(
  jti: string,
  userId: number,
  expiresAt: Date
): Promise<void> {
  return revokeTokenByJti(
    scopedTokenRevocationJti(userId, jti),
    userId,
    expiresAt
  )
}
