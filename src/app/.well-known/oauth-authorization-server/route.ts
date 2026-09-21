import { NextResponse } from 'next/server'

const OAUTH_ISSUER = process.env.JWT_ISSUER || 'https://app.hypertask.ai'
const BASE_URL = process.env.NEXT_PUBLIC_BASEURL || OAUTH_ISSUER

/**
 * GET /.well-known/oauth-authorization-server
 * 
 * Returns OAuth 2.1 authorization server metadata as per RFC 8414
 * This endpoint allows OAuth clients to discover server capabilities
 */
export async function GET() {
  const metadata = {
    issuer: OAUTH_ISSUER,
    authorization_endpoint: `${BASE_URL}/oauth/authorize`,
    token_endpoint: `${BASE_URL}/oauth/token`,
    registration_endpoint: `${BASE_URL}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp:full'],
  }

  return NextResponse.json(metadata, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
    },
  })
}
