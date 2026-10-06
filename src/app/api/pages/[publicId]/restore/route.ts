import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import { isValidUser } from '@/utils/edgeHelpers'
import { readJsonBody } from '@/lib/mcp/readJsonBody'
import { parsePositiveInt } from '@/lib/parsePositiveInt'
import { loadCurrentUser } from '@/lib/auth/currentUser'
import { HTPR_6924_REST_COMPAT_FLAG, isFeatureEnabled } from '@/lib/flags'
import { getPage, restorePageVersion } from '@/utils/controllers/pages/pageService'

type RouteContext = { params: Promise<{ publicId: string }> }
type RestorePageBody = { version_id?: unknown }

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null
}

function isRequestBody(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const currentUser = await loadCurrentUser(request.headers, true).catch(() => null)
    let restCompat = false
    if (currentUser) {
      try {
        restCompat = await isFeatureEnabled(HTPR_6924_REST_COMPAT_FLAG, currentUser.userId)
      } catch {
        // A failed flag probe must leave the legacy HTTP contract unchanged.
      }
    }

    let userId: number
    if (restCompat && currentUser) {
      userId = currentUser.userId
    } else {
      const userCookie = (await cookies()).get('nookies_user')
      if (!userCookie?.value) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      const { isValid, user } = isValidUser(userCookie.value)
      if (!isValid || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      userId = user.id
    }

    let parsedBody: unknown
    if (restCompat) {
      const result = await readJsonBody<Record<string, unknown>>(request, {
        invalidJson: () => NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 }),
        invalidObject: () => NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 }),
      })
      if (!result.ok) return result.response
      parsedBody = result.body
    } else {
      try {
        parsedBody = await request.json()
      } catch {
        return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
      }
      if (!isRequestBody(parsedBody)) {
        return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
      }
    }
    const body = parsedBody as RestorePageBody

    const versionId = restCompat
      ? (typeof body.version_id === 'number' ? parsePositiveInt(body.version_id, { safe: false, max: Infinity }) : null)
      : positiveInteger(body.version_id)
    if (versionId === null) {
      return NextResponse.json({ error: 'version_id must be a positive integer' }, { status: 400 })
    }

    const { publicId } = await params
    const existingPage = await getPage({ publicId, userId })
    if (!existingPage) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 })
    }

    try {
      const page = await restorePageVersion({
        pageId: existingPage.id,
        versionId,
        userId,
        agentId: null,
      })

      return NextResponse.json({
        page: {
          publicId: page.publicId,
          id: page.id,
          version: page.version,
        },
      })
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return NextResponse.json({ error: 'Version not found' }, { status: 404 })
      }
      throw error
    }
  } catch (error) {
    console.error('[Restore Page Version] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
