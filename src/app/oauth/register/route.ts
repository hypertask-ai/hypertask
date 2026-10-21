import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import prisma from '@/lib/prisma'
import { isValidRedirectUri } from '@/lib/oauth/redirect-uri'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    if (!body.redirect_uris || !Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
      return NextResponse.json(
        { error: 'invalid_client_metadata', error_description: 'redirect_uris is required and must be a non-empty array' },
        { status: 400 }
      )
    }

    for (const uri of body.redirect_uris) {
      if (typeof uri !== 'string') {
        return NextResponse.json(
          { error: 'invalid_client_metadata', error_description: 'redirect_uris must be an array of strings' },
          { status: 400 }
        )
      }

      if (!isValidRedirectUri(uri)) {
        return NextResponse.json(
          { error: 'invalid_redirect_uri', error_description: `Invalid redirect_uri format. Must be localhost, HTTPS, or a valid custom URI scheme: ${uri}` },
          { status: 400 }
        )
      }
    }

    if (
      body.client_name !== undefined &&
      body.client_name !== null &&
      (typeof body.client_name !== 'string' || body.client_name.length > 200)
    ) {
      return NextResponse.json(
        { error: 'invalid_client_metadata', error_description: 'client_name must be a string of 200 characters or fewer' },
        { status: 400 }
      )
    }

    if (
      body.token_endpoint_auth_method !== undefined &&
      body.token_endpoint_auth_method !== 'none'
    ) {
      return NextResponse.json(
        { error: 'invalid_client_metadata', error_description: 'Only public clients using token_endpoint_auth_method "none" are supported' },
        { status: 400 }
      )
    }

    const allowedGrantTypes = new Set(['authorization_code', 'refresh_token'])
    if (
      body.grant_types &&
      (!Array.isArray(body.grant_types) ||
        !body.grant_types.includes('authorization_code') ||
        body.grant_types.some((grantType: unknown) =>
          typeof grantType !== 'string' || !allowedGrantTypes.has(grantType)
        ))
    ) {
      return NextResponse.json(
        { error: 'invalid_client_metadata', error_description: 'grant_types must contain only "authorization_code" and optional "refresh_token"' },
        { status: 400 }
      )
    }

    const clientId = randomUUID()

    const clientData = {
      client_id: clientId,
      client_name: body.client_name || null,
      redirect_uris: body.redirect_uris,
      grant_types: body.grant_types || ['authorization_code'],
      token_endpoint_auth_method: body.token_endpoint_auth_method || 'none',
    }

    try {
      await prisma.oAuthClient.create({
        data: {
          client_id: clientData.client_id,
          client_name: clientData.client_name,
          redirect_uris: clientData.redirect_uris,
          grant_types: clientData.grant_types,
          token_endpoint_auth_method: clientData.token_endpoint_auth_method,
        }
      })
    } catch (error) {
      console.error('Error storing OAuth client:', error)
      return NextResponse.json(
        { error: 'server_error', error_description: 'Failed to register client' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      client_id: clientData.client_id,
      client_name: clientData.client_name,
      redirect_uris: clientData.redirect_uris,
      grant_types: clientData.grant_types,
      token_endpoint_auth_method: clientData.token_endpoint_auth_method,
    }, {
      status: 201,
      headers: {
        'Content-Type': 'application/json',
      }
    })
  } catch (error) {
    console.error('Error in OAuth register endpoint:', error)
    
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'Invalid JSON in request body' },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'server_error', error_description: 'Internal server error' },
      { status: 500 }
    )
  }
}
