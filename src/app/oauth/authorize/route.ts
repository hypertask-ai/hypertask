import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session'
import prisma from '@/lib/prisma'
import { generateAuthCode } from '@/lib/oauth/pkce'
import { buildRedirectUrl } from '@/lib/oauth/redirect-uri'
import { signConsentToken, verifyConsentToken } from '@/lib/oauth/consent'


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
  user: { id: number; uid: string | null },
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
        firebase_uid: user.uid || String(user.id),
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

  const customSchemePattern = /^[a-z][a-z0-9+.-]*:\/\//
  if (customSchemePattern.test(validated.redirectUri.toLowerCase())) {
    const successUrl = new URL('/oauth/success', request.url)
    successUrl.searchParams.set('redirect_uri', finalRedirectUrl)
    successUrl.searchParams.set('code', authCode)
    return NextResponse.redirect(successUrl.toString(), redirectStatus)
  }

  return NextResponse.redirect(finalRedirectUrl, redirectStatus)
}

function copyFormParams(form: FormData, url: URL) {
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string' && key !== 'consent_token') {
      url.searchParams.set(key, value)
    }
  }
}

async function currentSessionUser() {
  const cookieStore = await cookies()
  const session = verifySession(cookieStore.get(SESSION_COOKIE)?.value)
  if (!session) return null

  const dbUser = await prisma.user.findUnique({
    where: { id: session.id },
    select: { uid: true },
  })

  if (!dbUser) return null
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
      const loginUrl = new URL('/login', request.url)
      searchParams.forEach((value, key) => {
        loginUrl.searchParams.set(key, value)
      })

      return NextResponse.redirect(loginUrl.toString())
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

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData()
    const validation = await validateAuthorizationRequest(readParams(form))
    if (!validation.ok) return validation.response

    const validated = validation.request
    const user = await currentSessionUser()

    if (!user) {
      const loginUrl = new URL('/login', request.url)
      copyFormParams(form, loginUrl)

      return NextResponse.redirect(loginUrl.toString(), 303)
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
      const consentUrl = new URL('/oauth/consent', request.url)
      copyFormParams(form, consentUrl)

      return NextResponse.redirect(consentUrl.toString(), 303)
    }

    await prisma.oAuthClientGrant.upsert({
      where: { user_id_client_id: { user_id: user.id, client_id: validated.clientId } },
      update: {},
      create: { user_id: user.id, client_id: validated.clientId },
    })

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
