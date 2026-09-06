import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session'
import prisma from '@/lib/prisma'
import { generateAuthCode } from '@/lib/oauth/pkce'
import { buildRedirectUrl } from '@/lib/oauth/redirect-uri'
import { signConsentToken, verifyConsentToken } from '@/lib/oauth/consent'

/**
 * /oauth/authorize
 *
 * OAuth 2.1 authorization endpoint with PKCE.
 *
 * Params (query on GET, form body on POST):
 * - response_type: Must be "code"
 * - client_id: Client identifier
 * - redirect_uri: Where to redirect after authorization
 * - code_challenge: PKCE code challenge (base64url encoded SHA256)
 * - code_challenge_method: Must be "S256"
 * - state: Optional state parameter for CSRF protection
 * - agent_id: Optional Agent UUID; if set, access token will bind to this agent (must belong to user, not revoked)
 *
 * HTPR-6200: a GET no longer mints an authorization code. Because the session cookie
 * rides along on any top-level navigation, a GET is not evidence that the user asked
 * for this connection, so an unapproved client is sent to the /oauth/consent screen.
 * The code is minted only by POST, which requires the signed consent token that screen
 * embeds, or by a GET whose client the user has already approved (OAuthClientGrant).
 */

type AuthorizationRequest = {
  responseType: string | null
  clientId: string | null
  redirectUri: string | null
  codeChallenge: string | null
  codeChallengeMethod: string | null
  state: string | null
  agentId: string | null
}

type ValidatedRequest = {
  clientId: string
  redirectUri: string
  codeChallenge: string
  state: string | null
  agentIdParam: string | null
}

function readParams(source: URLSearchParams | FormData): AuthorizationRequest {
  const read = (key: string): string | null => {
    const value = source.get(key)
    return typeof value === 'string' ? value : null
  }

  return {
    responseType: read('response_type'),
    clientId: read('client_id'),
    redirectUri: read('redirect_uri'),
    codeChallenge: read('code_challenge'),
    codeChallengeMethod: read('code_challenge_method'),
    state: read('state'),
    agentId: read('agent_id'),
  }
}

function invalid(description: string, error = 'invalid_request', status = 400) {
  return NextResponse.json({ error, error_description: description }, { status })
}

/**
 * Shared by GET and POST so the two paths can never drift on what they accept.
 * Returns either a validated request or the error response to send back.
 */
async function validateAuthorizationRequest(
  params: AuthorizationRequest
): Promise<{ ok: true; request: ValidatedRequest } | { ok: false; response: NextResponse }> {
  if (params.responseType !== 'code') {
    return { ok: false, response: invalid('response_type must be "code"') }
  }

  if (!params.clientId || !params.redirectUri || !params.codeChallenge || !params.codeChallengeMethod) {
    return { ok: false, response: invalid('Missing required parameters') }
  }

  if (params.codeChallengeMethod !== 'S256') {
    return { ok: false, response: invalid('code_challenge_method must be "S256"') }
  }

  const client = await prisma.oAuthClient.findUnique({
    where: { client_id: params.clientId },
  })

  if (!client) {
    return { ok: false, response: invalid('Invalid client_id', 'invalid_client') }
  }

  const registeredUris = client.redirect_uris as string[]
  if (!registeredUris.includes(params.redirectUri)) {
    return { ok: false, response: invalid('redirect_uri does not match registered URIs') }
  }

  return {
    ok: true,
    request: {
      clientId: params.clientId,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state,
      agentIdParam: params.agentId,
    },
  }
}

/** Confirms an optional agent_id belongs to this user and is not revoked. */
async function resolveAgentId(
  agentIdParam: string | null,
  userId: number
): Promise<{ ok: true; agentId: string | null } | { ok: false; response: NextResponse }> {
  if (!agentIdParam) {
    return { ok: true, agentId: null }
  }

  const agent = await prisma.agent.findFirst({
    where: { id: agentIdParam, userId, revokedAt: null },
    select: { id: true },
  })

  if (!agent) {
    return { ok: false, response: invalid('Invalid or revoked agent_id') }
  }

  return { ok: true, agentId: agent.id }
}

async function issueCodeAndRedirect(
  request: NextRequest,
  validated: ValidatedRequest,
  user: { id: number; uid: string },
  agentIdToStore: string | null,
  redirectStatus: 303 | 307
) {
  const authCode = generateAuthCode()

  const expiresAt = new Date()
  expiresAt.setMinutes(expiresAt.getMinutes() + 10)

  try {
    await prisma.oAuthAuthorizationCode.create({
      data: {
        code: authCode,
        client_id: validated.clientId,
        redirect_uri: validated.redirectUri,
        code_challenge: validated.codeChallenge,
        firebase_uid: user.uid,
        user_id: user.id,
        agent_id: agentIdToStore,
        expires_at: expiresAt,
        used: false,
      },
    })
  } catch (error) {
    console.error('Error storing authorization code:', error)
    return invalid('Failed to store authorization code', 'server_error', 500)
  }

  const redirectParams: Record<string, string> = { code: authCode }
  if (validated.state) {
    redirectParams.state = validated.state
  }

  const finalRedirectUrl = buildRedirectUrl(validated.redirectUri, redirectParams)

  // Every absolute URI matches, http(s) included, so in practice all clients hand off
  // through /oauth/success. That is what makes cursor:// style schemes work at all:
  // a server redirect to a non-web scheme is not followed reliably.
  const customSchemePattern = /^[a-z][a-z0-9+.-]*:\/\//
  if (customSchemePattern.test(validated.redirectUri.toLowerCase())) {
    const successUrl = new URL('/oauth/success', request.url)
    successUrl.searchParams.set('redirect_uri', finalRedirectUrl)
    successUrl.searchParams.set('code', authCode)
    return NextResponse.redirect(successUrl.toString(), redirectStatus)
  }

  return NextResponse.redirect(finalRedirectUrl, redirectStatus)
}

/** Resolves identity only from the signed, HttpOnly session. nookies_user is a
 * client-writable presentation cache and must never select the OAuth subject. */
async function currentSessionUser() {
  const cookieStore = await cookies()
  const session = verifySession(cookieStore.get(SESSION_COOKIE)?.value)
  if (!session) return null

  const dbUser = await prisma.user.findUnique({
    where: { id: session.id },
    select: { uid: true },
  })

  if (!dbUser || !dbUser.uid) return { id: session.id, uid: null }
  return { id: session.id, uid: dbUser.uid }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const validation = await validateAuthorizationRequest(readParams(searchParams))
    if (!validation.ok) return validation.response

    const validated = validation.request
    const user = await currentSessionUser()

    if (!user) {
      // User not authenticated - redirect to main login page with OAuth params preserved
      const loginUrl = new URL('/login', request.url)
      searchParams.forEach((value, key) => {
        loginUrl.searchParams.set(key, value)
      })

      return NextResponse.redirect(loginUrl.toString())
    }

    if (!user.uid) {
      return invalid('User Firebase UID not found', 'server_error', 500)
    }

    const agent = await resolveAgentId(validated.agentIdParam, user.id)
    if (!agent.ok) return agent.response

    const alreadyApproved = await prisma.oAuthClientGrant.findUnique({
      where: { user_id_client_id: { user_id: user.id, client_id: validated.clientId } },
      select: { id: true },
    })

    if (!alreadyApproved) {
      const consentUrl = new URL('/oauth/consent', request.url)
      searchParams.forEach((value, key) => {
        consentUrl.searchParams.set(key, value)
      })
      consentUrl.searchParams.set(
        'consent_token',
        signConsentToken({
          userId: user.id,
          clientId: validated.clientId,
          redirectUri: validated.redirectUri,
          codeChallenge: validated.codeChallenge,
          agentId: agent.agentId,
        })
      )

      return NextResponse.redirect(consentUrl.toString())
    }

    return await issueCodeAndRedirect(
      request,
      validated,
      { id: user.id, uid: user.uid },
      agent.agentId,
      307
    )
  } catch (error) {
    console.error('Error in OAuth authorize endpoint:', error)
    return invalid('Internal server error', 'server_error', 500)
  }
}

/**
 * The approve button on /oauth/consent posts here. A cross-site POST cannot carry
 * the SameSite=lax session cookie, and cannot mint a consent token either, so this
 * is the only place a code gets created for a connector the user has not approved.
 */
export async function POST(request: NextRequest) {
  try {
    const form = await request.formData()
    const validation = await validateAuthorizationRequest(readParams(form))
    if (!validation.ok) return validation.response

    const validated = validation.request
    const user = await currentSessionUser()

    if (!user) {
      // The session lapsed while the consent screen sat open. Send them through
      // login with the request intact so the flow resumes instead of dead-ending.
      const loginUrl = new URL('/login', request.url)
      for (const [key, value] of form.entries()) {
        if (typeof value === 'string' && key !== 'consent_token') {
          loginUrl.searchParams.set(key, value)
        }
      }

      return NextResponse.redirect(loginUrl.toString(), 303)
    }

    if (!user.uid) {
      return invalid('User Firebase UID not found', 'server_error', 500)
    }

    const agent = await resolveAgentId(validated.agentIdParam, user.id)
    if (!agent.ok) return agent.response

    const consentToken = form.get('consent_token')
    const approved = verifyConsentToken(
      typeof consentToken === 'string' ? consentToken : null,
      {
        userId: user.id,
        clientId: validated.clientId,
        redirectUri: validated.redirectUri,
        codeChallenge: validated.codeChallenge,
        agentId: agent.agentId,
      }
    )

    if (!approved) {
      // A person is looking at this, not a machine, so send them to the consent
      // screen's own expiry page rather than raw JSON in the address bar. Dropping
      // the stale token is what makes that page render the expired state.
      const consentUrl = new URL('/oauth/consent', request.url)
      for (const [key, value] of form.entries()) {
        if (typeof value === 'string' && key !== 'consent_token') {
          consentUrl.searchParams.set(key, value)
        }
      }

      return NextResponse.redirect(consentUrl.toString(), 303)
    }

    // Remember the approval so reconnecting this connector is one click.
    await prisma.oAuthClientGrant.upsert({
      where: { user_id_client_id: { user_id: user.id, client_id: validated.clientId } },
      update: {},
      create: { user_id: user.id, client_id: validated.clientId },
    })

    // 303 so the browser turns the form POST into a GET on the client callback.
    return await issueCodeAndRedirect(
      request,
      validated,
      { id: user.id, uid: user.uid },
      agent.agentId,
      303
    )
  } catch (error) {
    console.error('Error in OAuth authorize endpoint:', error)
    return invalid('Internal server error', 'server_error', 500)
  }
}
