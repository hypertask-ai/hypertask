import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { maybeSendWelcomeEmail } from '@/lib/onboarding/emails/welcome'
import { maybeScheduleAgentNudge } from '@/lib/onboarding/emails/agentNudge'
import { takeSignupCodeContext } from '@/lib/auth/signupAttributionContext'
import crypto from 'crypto'
import { VerificationCodeService } from '@/lib/services/verificationCodeService'
import update_or_create_user from '@/utils/controllers/users/update_or_create_user'
import { IProject, ITaskShare } from '@/models/model'
import authConfig from '@/lib/configs/auth.config'
import autoJoinByEmailDomain from '@/utils/controllers/users/autoJoinByEmailDomain'
import { provisionFirstWorkspace } from '@/utils/controllers/users/provisionFirstWorkspace'
import { companyRoleOptions, companySizeOptions } from '@/lib/constants/constants'
import prisma from '@/lib/prisma'
import { getRequestBaseUrl } from '@/lib/auth/requestBaseUrl'
import { SESSION_COOKIE, SESSION_TTL_SECONDS, clearBetterAuthSessionCookies, sessionCookieOptions, signSession } from '@/lib/auth/session'
import { adoptGuestBoards } from '@/utils/controllers/demo/adoptGuestBoards'
import { resolveLoginBoard } from '@/utils/controllers/demo/resolveLoginBoard'
import { slimUserForCookie } from '@/lib/auth/slimUserCookie'
import { seedResponseThemeCookie } from '@/lib/auth/themeCookie'
import {
  claimEmailCodeAttempt,
  getEmailCodeClientIp,
} from '@/lib/auth/emailCodeRateLimit'
import { signupAttributionFromHeaders } from '@/lib/telemetry/signupAnalytics'

export async function POST(request: NextRequest) {
  try {
    const { code, email, abTestVariant } = await request.json()

    if (
      !code ||
      typeof code !== 'string' ||
      !email ||
      typeof email !== 'string'
    ) {
      return NextResponse.json(
        { success: false, error: 'Email and verification code are required' },
        { status: 400 }
      )
    }

    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail || normalizedEmail.length > 320) {
      return NextResponse.json(
        { success: false, error: 'Email and verification code are required' },
        { status: 400 }
      )
    }

    const clientIp = getEmailCodeClientIp(request)
    if (!clientIp) {
      return NextResponse.json(
        {
          success: false,
          error: 'Verification is temporarily unavailable. Please try again later.',
        },
        { status: 503 }
      )
    }

    const attempt = await claimEmailCodeAttempt(normalizedEmail, clientIp)
    if (!attempt.ipAllowed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Too many verification attempts. Please request a new code later.',
        },
        { status: 429 }
      )
    }

    console.log('🧪 AB Test Variant:', abTestVariant)

    const verifiedEmail = await VerificationCodeService.verifyCode(
      code,
      normalizedEmail
    )
    if (!verifiedEmail) {
      if (!attempt.emailAllowed) {
        return NextResponse.json(
          {
            success: false,
            error: 'Too many verification attempts. Please request a new code later.',
          },
          { status: 429 }
        )
      }

      return NextResponse.json(
        { success: false, error: 'Invalid or expired verification code' },
        { status: 400 }
      )
    }

    console.log('✅ Code verified for email:', verifiedEmail)

    const existingUser = await prisma.user.findFirst({
      where: { email: verifiedEmail },
      select: {
        uid: true,
        displayName: true,
        photoURL: true,
      },
    })

    const userUpdateResult = await update_or_create_user(
      verifiedEmail,
      {
        uid: existingUser?.uid ?? `email_${crypto.randomUUID()}`,
        displayName: existingUser?.displayName || verifiedEmail.split('@')[0],
        photoURL: existingUser?.photoURL,
      },
      authConfig.onboarding.shouldSkipInteractive,
      authConfig.onboarding.skipOnboarding,
      true,
      signupAttributionFromHeaders(request.headers, 'email'),
      await takeSignupCodeContext(verifiedEmail, code),
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

    if (userData.UserSetting) {
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
        relationLoadStrategy: 'join',
        where: { id: userData.id },
        include: { UserSetting: true, userPicture: true },
      })
      if (updatedUser) {
        userData = updatedUser as any
      }
    }

    console.log('✅ User updated successfully:', {
      id: userData!.id,
      email: userData!.email,
      displayName: userData!.displayName,
      onboardingTourStatus: (userData as any).UserSetting?.onboardingTourStatus,
      trialStatus: (userData as any).UserSetting?.trialStatus
    })

    let welcomeBoardId: number | undefined
    if (userUpdateResult.res.isNewUser && authConfig.onboarding.skipOnboarding) {
      try {
        console.log('🚀 Completing onboarding step 1 for new email-code user')
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
    console.log('📋 User projects fetched:', prevBoard)

    const response = NextResponse.json({
      success: true,
      user: userData,
      prevBoard: prevBoard,
      isNewUser: userUpdateResult.res.isNewUser,
      redirectUrl: loginBoard === null ? '/onboarding' : getRedirectUrl(userData, prevBoard, false, abTestVariant, undefined, undefined, userUpdateResult.res.isNewUser),
      message: 'Email verified and signed in successfully!',
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
        console.log('✅ Previous board cookie set:', `project-${prevBoard.id}`)
      }

      if (loginBoard === null) response.cookies.delete('previousBoard')

      response.cookies.set('signup_source', 'email_code', {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7,
        path: '/'
      })

      waitUntil(maybeSendWelcomeEmail(userData!.id, { boardId: welcomeBoardId }))
      waitUntil(maybeScheduleAgentNudge(userData!.id))

      console.log('✅ Authentication cookies set successfully')
    } catch (cookieError) {
      console.error('⚠️  Cookie setting failed:', cookieError)
    }

    return response

  } catch (error) {
    console.error('❌ Error verifying code:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to verify code' },
      { status: 500 }
    )
  }
}

async function getProjects(
  userId: number,
  baseUrl: string
): Promise<IProject | undefined> {
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
  const { onboardingTutorialStatus } = user?.UserSetting || {}
  console.log('🔄 getRedirectUrl - onboardingTutorialStatus:', onboardingTutorialStatus)
  console.log('🧪 getRedirectUrl - abTestVariant:', abTestVariant)
  console.log('👤 getRedirectUrl - isNewUser:', isNewUser)

  const getSharedTaskUrl = () =>
    sharedTask
      ? `/detail/project-${sharedTask.projectId}/${sharedTask.task?.uniqueIndex}`
      : ""

  const getProjectUrl = () =>
    `/project?id=${prevBoard?.id}${view ? `&view=${view}` : ""}`

  if (onboardingTutorialStatus) {
    return sharedTask ? getSharedTaskUrl() : getProjectUrl()
  }

  return `/onboarding?projectId=${prevBoard?.id}&teamTitle=${
    prevBoard?.team?.title || 'MyTeam'
  }&id=${prevBoard?.team?.id || ''}${sharedTask ? `&shareId=${sharedTask.id}` : ""}`
}

export async function GET() {
  const stats = await VerificationCodeService.getStats()
  
  return NextResponse.json({
    stats,
    currentTime: new Date().toISOString()
  })
}
