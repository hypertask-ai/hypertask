import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { isValidUser } from '@/utils/edgeHelpers'
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session'
import prisma from '@/lib/prisma'
import { generateAuthCode } from '@/lib/oauth/pkce'
import { buildRedirectUrl } from '@/lib/oauth/redirect-uri'

/**
 * GET /oauth/authorize
 * 
 * OAuth 2.1 authorization endpoint with PKCE
 * 
 * Query params:
 * - response_type: Must be "code"
 * - client_id: Client identifier
 * - redirect_uri: Where to redirect after authorization
 * - code_challenge: PKCE code challenge (base64url encoded SHA256)
 * - code_challenge_method: Must be "S256"
 * - state: Optional state parameter for CSRF protection
 * - agent_id: Optional Agent UUID; if set, access token will bind to this agent (must belong to user, not revoked)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams

    // Validate required parameters
    const responseType = searchParams.get('response_type')
    const clientId = searchParams.get('client_id')
    const redirectUri = searchParams.get('redirect_uri')
    const codeChallenge = searchParams.get('code_challenge')
    const codeChallengeMethod = searchParams.get('code_challenge_method')
    const state = searchParams.get('state')

    // Validate response_type
    if (responseType !== 'code') {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'response_type must be "code"' },
        { status: 400 }
      )
    }

    // Validate required parameters
    if (!clientId || !redirectUri || !codeChallenge || !codeChallengeMethod) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'Missing required parameters' },
        { status: 400 }
      )
    }

    // Validate code_challenge_method
    if (codeChallengeMethod !== 'S256') {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'code_challenge_method must be "S256"' },
        { status: 400 }
      )
    }

    // Look up client in database
    const client = await prisma.oAuthClient.findUnique({
      where: { client_id: clientId }
    })

    if (!client) {
      return NextResponse.json(
        { error: 'invalid_client', error_description: 'Invalid client_id' },
        { status: 400 }
      )
    }

    // Validate redirect_uri matches one of the registered URIs
    const registeredUris = client.redirect_uris as string[]
    if (!registeredUris.includes(redirectUri)) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'redirect_uri does not match registered URIs' },
        { status: 400 }
      )
    }

    // Check if user is authenticated.
    // nookies_user is client-writable JSON, so it proves nothing on its own. The
    // HTPR-4182 edge gate enforces "nookies_user must match a signed ht_session"
    // for /api and page routes, but proxy.ts lets /oauth through untouched, so
    // this endpoint has to enforce the same invariant itself — otherwise anyone
    // can forge {id: victimId} and mint an authorization code bound to that user.
    const cookieStore = await cookies()
    const userCookie = cookieStore.get('nookies_user')
    const { isValid, user } = isValidUser(userCookie?.value)
    const session = verifySession(cookieStore.get(SESSION_COOKIE)?.value)
    const sessionMatchesCookie =
      !!session && !!user && Number(session.id) === Number(user.id)

    if (!isValid || !user || !user.id || !sessionMatchesCookie) {
      // User not authenticated - redirect to main login page with OAuth params preserved
      const loginUrl = new URL('/login', request.url)
      // Preserve all OAuth query parameters
      searchParams.forEach((value, key) => {
        loginUrl.searchParams.set(key, value)
      })
      
      return NextResponse.redirect(loginUrl.toString())
    }

    // User is authenticated - get Firebase UID from database
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { uid: true, email: true }
    })

    if (!dbUser || !dbUser.uid) {
      return NextResponse.json(
        { error: 'server_error', error_description: 'User Firebase UID not found' },
        { status: 500 }
      )
    }

    const agentIdParam = searchParams.get('agent_id')
    let agentIdToStore: string | null = null
    if (agentIdParam) {
      const agent = await prisma.agent.findFirst({
        where: {
          id: agentIdParam,
          userId: user.id,
          revokedAt: null,
        },
        select: { id: true },
      })
      if (!agent) {
        return NextResponse.json(
          { error: 'invalid_request', error_description: 'Invalid or revoked agent_id' },
          { status: 400 }
        )
      }
      agentIdToStore = agent.id
    }

    // Generate authorization code
    const authCode = generateAuthCode()

    // Calculate expiration (10 minutes from now)
    const expiresAt = new Date()
    expiresAt.setMinutes(expiresAt.getMinutes() + 10)

    // Store authorization code in database
    try {
      await prisma.oAuthAuthorizationCode.create({
        data: {
          code: authCode,
          client_id: clientId,
          redirect_uri: redirectUri,
          code_challenge: codeChallenge,
          firebase_uid: dbUser.uid,
          user_id: user.id,
          agent_id: agentIdToStore,
          expires_at: expiresAt,
          used: false,
        }
      })
    } catch (error) {
      console.error('Error storing authorization code:', error)
      return NextResponse.json(
        { error: 'server_error', error_description: 'Failed to store authorization code' },
        { status: 500 }
      )
    }

    // Build redirect URL with code and state
    const redirectParams: Record<string, string> = {
      code: authCode
    }
    if (state) {
      redirectParams.state = state
    }

    const finalRedirectUrl = buildRedirectUrl(redirectUri, redirectParams)

    // Check if redirect_uri is a custom URI scheme (like cursor://)
    // If so, redirect to an intermediate success page that will redirect to the client
    // and also allow the user to continue to the app
    const customSchemePattern = /^[a-z][a-z0-9+.-]*:\/\//
    if (customSchemePattern.test(redirectUri.toLowerCase())) {
      // Redirect to success page with the OAuth client redirect URL
      const successUrl = new URL('/oauth/success', request.url)
      successUrl.searchParams.set('redirect_uri', finalRedirectUrl)
      successUrl.searchParams.set('code', authCode)
      return NextResponse.redirect(successUrl.toString())
    }

    // For standard URLs (HTTPS/localhost), redirect directly
    return NextResponse.redirect(finalRedirectUrl)
  } catch (error) {
    console.error('Error in OAuth authorize endpoint:', error)
    return NextResponse.json(
      { error: 'server_error', error_description: 'Internal server error' },
      { status: 500 }
    )
  }
}
