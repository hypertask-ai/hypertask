import { standalonePagesEnabled } from '@/utils/controllers/pages/standalonePagesEnabled'
import { checkRestRateLimit } from '@/lib/api/rateLimit'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import { isValidUser } from '@/utils/edgeHelpers'
import { readJsonBody } from '@/lib/mcp/readJsonBody'
import { parsePositiveInt } from '@/lib/parsePositiveInt'
import { loadCurrentUser } from '@/lib/auth/currentUser'
import { getPage, restorePageVersion } from '@/utils/controllers/pages/pageService'

type RouteContext = { params: Promise<{ publicId: string }> }
type RestorePageBody = { version_id?: unknown }

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const currentUser = await loadCurrentUser(request.headers, true).catch(() => null)

    let userId: number
    if (currentUser) {
      userId = currentUser.userId
    } else {
      const userCookie = (await cookies()).get('nookies_user')
      if (!userCookie?.value) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      const { isValid, user } = isValidUser(userCookie.value)
      if (!isValid || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      userId = user.id
    }

    if (currentUser) {
      const limited = await checkRestRateLimit(currentUser.userId, 'write')
      if (limited) return limited
    }

    let parsedBody: unknown
    const result = await readJsonBody<Record<string, unknown>>(request, {
      invalidJson: () => NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 }),
      invalidObject: () => NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 }),
    })
    if (!result.ok) return result.response
    parsedBody = result.body
    const body = parsedBody as RestorePageBody

    const versionId = typeof body.version_id === 'number' ? parsePositiveInt(body.version_id, { safe: false, max: Infinity }) : null
    if (versionId === null) {
      return NextResponse.json({ error: 'version_id must be a positive integer' }, { status: 400 })
    }

    const { publicId } = await params
    const existingPage = await getPage({ publicId, userId, standalonePagesEnabled: await standalonePagesEnabled(userId) })
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
