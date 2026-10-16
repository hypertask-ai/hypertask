import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { maybeSendWelcomeEmail } from '@/lib/onboarding/emails/welcome'
import { maybeScheduleAgentNudge } from '@/lib/onboarding/emails/agentNudge'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import update_or_create_user from '@/utils/controllers/users/update_or_create_user'
import { IProject, ITaskShare } from '@/models/model'
import authConfig from '@/lib/configs/auth.config'
import autoJoinByEmailDomain from '@/utils/controllers/users/autoJoinByEmailDomain'
import { provisionFirstWorkspace } from '@/utils/controllers/users/provisionFirstWorkspace'
import { companyRoleOptions, companySizeOptions } from '@/lib/constants/constants'
import prisma from '@/lib/prisma'
import { SESSION_COOKIE, SESSION_TTL_SECONDS, clearBetterAuthSessionCookies, sessionCookieOptions, signSession } from '@/lib/auth/session'
import { getRequestBaseUrl } from '@/lib/auth/requestBaseUrl'
import { adoptGuestBoards } from '@/utils/controllers/demo/adoptGuestBoards'
import { resolveLoginBoard } from '@/utils/controllers/demo/resolveLoginBoard'
import { slimUserForCookie } from '@/lib/auth/slimUserCookie'
import { seedResponseThemeCookie } from '@/lib/auth/themeCookie'
import { signupAttributionFromHeaders } from '@/lib/telemetry/signupAnalytics'
import { consumeEmailLinkToken } from '@/lib/auth/emailLinkToken'

const JWT_ISSUER = process.env.JWT_ISSUER || 'hypertask'
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'email-link'
const JWT_VERIFICATION_AUDIENCE = process.env.JWT_VERIFICATION_AUDIENCE || 'email-verification'

function getJwtSecret() {
  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret) {
    throw new Error('Missing JWT_SECRET env var')
  }
  return jwtSecret
}

export async function POST(request: NextRequest) {
  try {
    const { token, abTestVariant, shouldSkipInteractive } = await request.json()

    if (!token || typeof token !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Token is required' },
        { status: 400 }
      )
    }

    const skipInteractive = shouldSkipInteractive !== undefined 
      ? shouldSkipInteractive 
      : authConfig.onboarding.shouldSkipInteractive

    console.log('🧪 AB Test Variant (email link):', abTestVariant)
    console.log('⏭️  Should Skip Interactive (email link):', skipInteractive)

    let email: string
    let decoded: jwt.JwtPayload
    let isVerificationToken = false
    try {
      const jwtSecret = getJwtSecret()
      try {
        decoded = jwt.verify(token, jwtSecret, {
          issuer: JWT_ISSUER,
          audience: JWT_VERIFICATION_AUDIENCE,
        }) as jwt.JwtPayload
        isVerificationToken = true
        console.log('✅ Verified as email verification token')
      } catch {
        decoded = jwt.verify(token, jwtSecret, {
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        }) as jwt.JwtPayload
        isVerificationToken = false
        console.log('✅ Verified as login token (from instant signup)')
      }

      if (!decoded?.sub || typeof decoded.sub !== 'string') {
        return NextResponse.json(
          { success: false, error: 'Invalid token payload' },
          { status: 400 }
        )
      }
      email = decoded.sub.toLowerCase()
    } catch (err) {
      console.error('🔒 JWT verification failed:', err)
      return NextResponse.json(
        { success: false, error: 'Invalid or expired token' },
        { status: 400 }
      )
    }

    if (!await consumeEmailLinkToken(decoded)) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired token' },
        { status: 400 }
      )
    }

    const existingUser = await prisma.user.findFirst({
      where: { email },
      include: { UserSetting: true },
    })
    
    const shouldSkipOnboarding = existingUser?.UserSetting?.onboardingTourStatus ?? authConfig.onboarding.skipOnboarding
    
    const shouldSetVerified = isVerificationToken ? true : (existingUser?.UserSetting?.isVerified ?? true)
    
    const userUpdateResult = await update_or_create_user(
      email,
      {
        uid: existingUser?.uid ?? `email_${crypto.randomUUID()}`,
        displayName: existingUser?.displayName || email.split('@')[0],
        photoURL: existingUser?.photoURL,
      },
      skipInteractive,
      shouldSkipOnboarding,
      shouldSetVerified,
      signupAttributionFromHeaders(request.headers, 'email'),
      typeof decoded.signupContextId === 'string' ? decoded.signupContextId : null,
    )

    if (userUpdateResult.status !== 200) {
      console.error('❌ User update failed:', userUpdateResult)
      return NextResponse.json(
        { 
          success: false, 
          error: 'Failed to update user data',
          code: 'USER_UPDATE_FAILED'
        },
        { status: userUpdateResult.status }
      )
    }

    let userData = userUpdateResult.res.user
    if (!userData) {
      console.error('❌ User data not found in response')
      return NextResponse.json(
        { 
          success: false, 
          error: 'User data not found',
          code: 'USER_DATA_MISSING'
        },
        { status: 500 }
      )
    }

    if (isVerificationToken && userData.UserSetting) {
      console.log('📧 Email verification token - setting isVerified to true')
      await prisma.userSetting.update({
        where: { id: userData.UserSetting.id },
        data: { isVerified: true },
      })
      await prisma.user.update({
        where: { id: userData.id },
        data: { emailVerified: true },
      })
      try {
        await autoJoinByEmailDomain(userData.id, userData.email)
      } catch (error) {
        console.error('Auto-join by email domain failed (non-fatal):', error)
      }
      const updatedUser = await prisma.user.findUnique({
        where: { id: userData.id },
        include: { UserSetting: true, userPicture: true },
      })
      if (updatedUser) {
        userData = updatedUser as any
      }
    } else {
      console.log('🔐 Login token - preserving existing verification status')
    }

    console.log('✅ User updated successfully (email link):', {
      id: userData!.id,
      email: userData!.email,
      displayName: userData!.displayName,
      onboardingTutorialStatus: (userData as any).UserSetting?.onboardingTutorialStatus,
      onboardingTourStatus: (userData as any).UserSetting?.onboardingTourStatus,
      trialStatus: (userData as any).UserSetting?.trialStatus
    })

    let welcomeBoardId: number | undefined
    if (userUpdateResult.res.isNewUser && authConfig.onboarding.skipOnboarding) {
      try {
        console.log('🚀 Completing onboarding step 1 for new email-link user')
        const onboardingResult = await provisionFirstWorkspace(
          userData as any,
          request.cookies.get(SESSION_COOKIE)?.value,
          'MyTeam',
          'MyBoard',
          companySizeOptions[0],
          companyRoleOptions[0]
        )
        welcomeBoardId = onboardingResult?.Project?.id
        console.log('✅ Onboarding step 1 completed:', onboardingResult)
      } catch (onboardingError) {
        console.error('⚠️ Failed to complete onboarding step 1:', onboardingError)
      }
    }

    await adoptGuestBoards(request.cookies.get(SESSION_COOKIE)?.value, userData!.id)

    const loginBoard = await resolveLoginBoard(userData!.id, request.cookies.get('previousBoard')?.value)
    const prevBoard = loginBoard === undefined
      ? await getProjects(userData!.id, getRequestBaseUrl(request))
      : loginBoard
    console.log('📋 User projects fetched (email link):', prevBoard)

    const response = NextResponse.json({
      success: true,
      user: userData,
      prevBoard: prevBoard,
      isNewUser: userUpdateResult.res.isNewUser,
      redirectUrl: loginBoard === null ? '/onboarding' : getRedirectUrl(userData, prevBoard, false, abTestVariant, undefined, undefined, userUpdateResult.res.isNewUser),
      message: 'Email link verified and signed in successfully!',
      abTestVariant: abTestVariant
    })

    try {
      response.cookies.set('nookies_user', JSON.stringify(slimUserForCookie(userData)), {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 600 * 60 * 24 * 7,
        path: '/'
      })
      response.cookies.set(
        SESSION_COOKIE,
        signSession({ id: userData!.id, email: userData!.email }, SESSION_TTL_SECONDS),
        sessionCookieOptions(SESSION_TTL_SECONDS)
      )
      clearBetterAuthSessionCookies(response)

      seedResponseThemeCookie(request, response)

      if (prevBoard?.id) {
        response.cookies.set('previousBoard', `project-${prevBoard.id}|&|`, {
          httpOnly: false,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 600 * 60 * 24 * 7,
          path: '/'
        })
        console.log('✅ Previous board cookie set (email link):', `project-${prevBoard.id}`)
      }

      if (loginBoard === null) response.cookies.delete('previousBoard')

      response.cookies.set('signup_source', 'email_link', {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7,
        path: '/'
      })

      waitUntil(maybeSendWelcomeEmail(userData!.id, { boardId: welcomeBoardId }))
      waitUntil(maybeScheduleAgentNudge(userData!.id))

      console.log('✅ Authentication cookies set successfully (email link)')
    } catch (cookieError) {
      console.error('⚠️  Cookie setting failed (email link):', cookieError)
    }

    return response

  } catch (error) {
    console.error('❌ Error verifying email token:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to verify token' },
      { status: 500 }
    )
  }
}

async function getProjects(userId: number, baseUrl: string): Promise<IProject | undefined> {
  try {
    const response = await fetch(`${baseUrl}/api/projects/getAll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: userId }),
    })
    
    if (response.ok) {
      const data: IProject[] = await response.json()
      return data[0]
    }
  } catch (error) {
    console.error('❌ Error fetching projects:', error)
  }
  
  return undefined
}

function getRedirectUrl(
  user: any,
  prevBoard: any,
  isMobile: boolean,
  abTestVariant?: string,
  view?: string,
  sharedTask?: ITaskShare,
  isNewUser?: boolean
): string {
  const { onboardingTourStatus, isVerified } = user?.UserSetting || {}
  console.log('🔄 getRedirectUrl (email link) - onboardingTourStatus:', onboardingTourStatus)
  console.log('🧪 getRedirectUrl (email link) - abTestVariant:', abTestVariant)
  console.log('👤 getRedirectUrl (email link) - isNewUser:', isNewUser)
  console.log('✅ getRedirectUrl (email link) - isVerified:', isVerified)

  const getSharedTaskUrl = () =>
    sharedTask
      ? `/detail/project-${sharedTask.projectId}/${sharedTask.task?.uniqueIndex}`
      : ""

  const getProjectUrl = () =>
    `/project?id=${prevBoard?.id}${view ? `&view=${view}` : ""}`

  if (onboardingTourStatus) {
    return sharedTask ? getSharedTaskUrl() : getProjectUrl()
  }

  return `/onboarding?projectId=${prevBoard?.id}&teamTitle=${
    prevBoard?.team?.title || 'MyTeam'
  }&id=${prevBoard?.team?.id || ''}${sharedTask ? `&shareId=${sharedTask.id}` : ""}`
}
