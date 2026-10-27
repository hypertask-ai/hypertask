import { standalonePagesEnabled } from '@/utils/controllers/pages/standalonePagesEnabled'
import { checkRestRateLimit } from '@/lib/api/rateLimit'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import { isValidUser } from '@/utils/edgeHelpers'
import { loadCurrentUser } from '@/lib/auth/currentUser'
import { archivePage, getPage } from '@/utils/controllers/pages/pageService'

type RouteContext = { params: Promise<{ publicId: string }> }

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

    const { publicId } = await params
    const page = await getPage({ publicId, userId, standalonePagesEnabled: await standalonePagesEnabled(userId) })
    if (!page) return NextResponse.json({ error: 'Page not found' }, { status: 404 })

    await archivePage({ id: page.id, userId, agentId: null })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 })
    }

    console.error('[Archive Page] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
