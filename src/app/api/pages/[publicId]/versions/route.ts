import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import { isValidUser } from '@/utils/edgeHelpers'
import { loadCurrentUser } from '@/lib/auth/currentUser'
import { HTPR_6924_REST_COMPAT_FLAG, isFeatureEnabled } from '@/lib/flags'
import { getPage, listPageVersions } from '@/utils/controllers/pages/pageService'

type RouteContext = { params: Promise<{ publicId: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
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

    const { publicId } = await params
    const page = await getPage({ publicId, userId })
    if (!page) return NextResponse.json({ error: 'Page not found' }, { status: 404 })

    const versions = (await listPageVersions({ pageId: page.id })).map((version) => ({
      id: version.id,
      version: version.version,
      note: version.note,
      authorId: version.authorId,
      agentId: version.agentId,
      createdAt: version.createdAt,
    }))

    return NextResponse.json({ versions })
  } catch (error) {
    console.error('[List Page Versions] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
