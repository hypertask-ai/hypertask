import { NextRequest, NextResponse } from 'next/server'
import { validateMcpAuth, createUnauthorizedResponse, checkMcpRateLimit } from '@/lib/mcp/auth'
import {
  ProfileValidationError,
  updateOwnProfile,
} from '@/utils/controllers/users/updateOwnProfile'

type ProfilePatchBody = {
  displayName?: unknown
  photoURL?: unknown
}

function validationError(message: string, field: string, code: string) {
  return NextResponse.json(
    {
      success: false,
      error: 'Validation error',
      message,
      details: { field, code },
    },
    { status: 400 }
  )
}

function isObjectBody(body: unknown): body is ProfilePatchBody {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
}

function hasField(body: ProfilePatchBody, field: keyof ProfilePatchBody) {
  return Object.prototype.hasOwnProperty.call(body, field)
}

/**
 * PATCH /api/mcp/user/profile
 *
 * Updates the current human user's MCP-visible profile fields.
 * Authentication: Bearer token via MCP auth.
 */
export async function PATCH(request: NextRequest) {
  let userObj: { id: number; email: string } | null = null

  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)

    if (!ctx) {
      return createUnauthorizedResponse(
        'Invalid or missing authentication token.',
        'invalid_token'
      )
    }

    // Agent tokens act on behalf of an agent, not the human owner; they must
    // not be able to rename or re-avatar the underlying human account.
    if (ctx.agentId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Agent tokens cannot modify the human account profile',
          details: { field: 'auth', code: 'agent_forbidden' },
        },
        { status: 403 }
      )
    }

    const user = ctx.user
    userObj = user

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return validationError('Invalid request body', 'body', 'invalid_json')
    }

    if (!isObjectBody(body)) {
      return validationError('Request body must be a JSON object', 'body', 'invalid_type')
    }

    const bodyHasDisplayName = hasField(body, 'displayName')
    const bodyHasPhotoURL = hasField(body, 'photoURL')

    if (!bodyHasDisplayName && !bodyHasPhotoURL) {
      return validationError(
        'At least one of displayName or photoURL must be provided',
        'body',
        'no_fields_provided'
      )
    }

    if (
      bodyHasDisplayName &&
      body.displayName !== undefined &&
      body.displayName !== '' &&
      typeof body.displayName !== 'string'
    ) {
      return validationError('displayName must be a string', 'displayName', 'invalid_type')
    }

    if (
      bodyHasPhotoURL &&
      body.photoURL !== undefined &&
      body.photoURL !== '' &&
      typeof body.photoURL !== 'string'
    ) {
      return validationError('photoURL must be a string', 'photoURL', 'invalid_type')
    }

    let updatedUser
    try {
      updatedUser = await updateOwnProfile(user.id, {
        displayName:
          typeof body.displayName === 'string' ? body.displayName : undefined,
        photoURL: typeof body.photoURL === 'string' ? body.photoURL : undefined,
      })
    } catch (error) {
      if (error instanceof ProfileValidationError) {
        return validationError(error.message, error.field, error.code)
      }
      throw error
    }
    if (!updatedUser) {
      return createUnauthorizedResponse('User not found.', 'invalid_token')
    }

    return NextResponse.json({
      success: true,
      user: {
        id: updatedUser.id,
        email: user.email,
        displayName: updatedUser.displayName,
        photoURL: updatedUser.photoURL,
      },
    })
  } catch (error) {
    console.error('[MCP] user/profile', {
      user: userObj,
      error,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
      },
      { status: 500 }
    )
  }
}
