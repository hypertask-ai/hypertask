import { logger as htLogger } from "#logger";
import { withAuth } from "#with-auth";
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

async function GETHandler(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const userId = searchParams.get('userId')

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'User ID is required' },
        { status: 400 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { id: parseInt(userId) },
      include: { UserSetting: true },
    })
    htLogger.info('user', user)
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      )
    }

    const isVerified = user.UserSetting?.isVerified ?? true

    return NextResponse.json({
      success: true,
      isVerified,
      userId: user.id,
    })
  } catch (error) {
    htLogger.error('❌ Error checking verification status:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error',
        code: 'INTERNAL_ERROR'
      },
      { status: 500 }
    )
  }
}

export const GET = withAuth(GETHandler);
