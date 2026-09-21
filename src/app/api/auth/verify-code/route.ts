import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { VerificationCodeService } from '@/lib/services/verificationCodeService'
import update_or_create_user from '@/utils/controllers/users/update_or_create_user'
import { IProject, ITaskShare } from '@/models/model'
import authConfig from '@/lib/configs/auth.config'
import autoJoinByEmailDomain from '@/utils/controllers/users/autoJoinByEmailDomain'
import { CompleteOnboardingFirstStep } from '@/utils/controllers/users/completeOnboardingStep'
import { companyRoleOptions, companySizeOptions } from '@/lib/constants/constants'
import prisma from '@/lib/prisma'
import { getRequestBaseUrl } from '@/lib/auth/requestBaseUrl'
import { SESSION_COOKIE, SESSION_TTL_SECONDS, clearBetterAuthSessionCookies, sessionCookieOptions, signSession } from '@/lib/auth/session'
import { adoptGuestBoards } from '@/utils/controllers/demo/adoptGuestBoards'
import { slimUserForCookie } from '@/lib/auth/slimUserCookie'
import { seedResponseThemeCookie } from '@/lib/auth/themeCookie'
import {
  claimEmailCodeAttempt,
  getEmailCodeClientIp,
} from '@/lib/auth/emailCodeRateLimit'

// --------- Route Handler ---------
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

    // Vercel supplies the trusted client IP. Without it, fail closed rather
    // than let a caller choose the identity used by the hard IP budget.
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

    // Reserve capacity before comparing the code so parallel guesses cannot
    // all pass a separate check-then-increment rate limiter.
    const attempt = await claimEmailCodeAttempt(normalizedEmail, clientIp)
    // The IP budget is the hard pre-verification boundary. A shared email
    // budget cannot block this step: otherwise anyone who knows an address can
    // spend five guesses and prevent the owner from redeeming the correct code.
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

    // Verify the code
    const verifiedEmail = await VerificationCodeService.verifyCode(
      code,
      normalizedEmail
    )
    if (!verifiedEmail) {
      // The email count is a soft boundary for invalid guesses. Correct codes
      // are still consumed above, while repeated invalid attempts get a 429.
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

    // Update user in database (EXACTLY like useAuth.tsx does)
    const userUpdateResult = await update_or_create_user(
      verifiedEmail,
      {
        uid: existingUser?.uid ?? `email_${crypto.randomUUID()}`,
        displayName: existingUser?.displayName || verifiedEmail.split('@')[0],
        photoURL: existingUser?.photoURL,
      },
      authConfig.onboarding.shouldSkipInteractive,
      authConfig.onboarding.skipOnboarding,
      true // isVerified: true (email verified via code)
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

    // Ensure isVerified is set to true in UserSetting
    if (userData.UserSetting) {
      await prisma.userSetting.update({
        where: { id: userData.UserSetting.id },
        data: { isVerified: true },
      })
      // Keep the Better Auth column in sync, or a user who verifies by code
      // stays blocked from Google account linking forever (HTPR-4159 gate).
      await prisma.user.update({
        where: { id: userData.id },
        data: { emailVerified: true },
      })
      // The mailbox is now proven, so pick up any team that allowlisted this domain.
      // Idempotent, and the only auto-join chance an instant-signup user gets: they
      // were provisioned unverified, and provisionNewUser does not run again.
      try {
        await autoJoinByEmailDomain(userData.id, userData.email)
      } catch (error) {
        console.error('Auto-join by email domain failed (non-fatal):', error)
      }
      // Refetch user to get updated isVerified status
      const updatedUser = await prisma.user.findUnique({
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

    // Auto-provision a team/board for brand-new users so they land on a real
    // board instead of the empty state, matching instant-signup's behavior.
    if (userUpdateResult.res.isNewUser && authConfig.onboarding.skipOnboarding) {
      try {
        console.log('🚀 Completing onboarding step 1 for new email-code user')
        const onboardingResult = await CompleteOnboardingFirstStep(
          userData as any,
          'MyTeam', // Default team title
          'MyBoard', // Default board title
          companySizeOptions[0], // Default: "Just me"
          companyRoleOptions[0] // Default: "Founder or leadership team"
        )
        console.log('✅ Onboarding step 1 completed:', onboardingResult)
      } catch (onboardingError) {
        console.error('⚠️ Failed to complete onboarding step 1:', onboardingError)
        // Don't fail the request - user can still use the app
        // The onboarding can be completed later if needed
      }
    }

    // HTPR-4893: this browser may still be carrying the guest session it signed in
    // from, so hand that guest's boards over before we read the board list below —
    // then the adopted board is what prevBoard points the user at.
    await adoptGuestBoards(request.cookies.get(SESSION_COOKIE)?.value, userData!.id)

    // Get user's projects (EXACTLY like useAuth.tsx does)
    const prevBoard = await getProjects(userData!.id, getRequestBaseUrl(request))
    console.log('📋 User projects fetched:', prevBoard)

    // Create response with redirect URL following useAuth.tsx logic
    const response = NextResponse.json({
      success: true,
      user: userData, // Pass the full user data from database
      prevBoard: prevBoard, // Pass the project data
      isNewUser: userUpdateResult.res.isNewUser, // Pass the isNewUser flag
      redirectUrl: getRedirectUrl(userData, prevBoard, false, abTestVariant, undefined, undefined, userUpdateResult.res.isNewUser), // false = not mobile
      message: 'Email verified and signed in successfully!',
      abTestVariant: abTestVariant // Pass through for client-side tracking
    })

    // Set authentication cookies EXACTLY like useAuth.tsx
    try {
      // Set nookies_user cookie (main auth cookie)
      response.cookies.set('nookies_user', JSON.stringify(slimUserForCookie(userData)), {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 600 * 60 * 24 * 7, // 1 week
        path: '/'
      })
      response.cookies.set(
        SESSION_COOKIE,
        signSession({ id: userData!.id, email: userData!.email }, SESSION_TTL_SECONDS),
        sessionCookieOptions(SESSION_TTL_SECONDS)
      )
      clearBetterAuthSessionCookies(response)

      seedResponseThemeCookie(request, response)

      // Set previous board cookie if we have one (EXACTLY like useAuth.tsx)
      if (prevBoard?.id) {
        response.cookies.set('previousBoard', `project-${prevBoard.id}|&|`, {
          httpOnly: false,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 600 * 60 * 24 * 7, // 1 week
          path: '/'
        })
        console.log('✅ Previous board cookie set:', `project-${prevBoard.id}`)
      }

      // Track the source for analytics
      response.cookies.set('signup_source', 'email_code', {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7, // 7 days
        path: '/'
      })

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

// Helper functions from useAuth.tsx
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

  // Shared task URL generation helper
  const getSharedTaskUrl = () =>
    sharedTask
      ? `/detail/project-${sharedTask.projectId}/${sharedTask.task?.uniqueIndex}`
      : ""

  // Project URL with optional view parameter
  const getProjectUrl = () =>
    `/project?id=${prevBoard?.id}${view ? `&view=${view}` : ""}`

  // User has completed all onboarding steps
  if (onboardingTutorialStatus) {
    return sharedTask ? getSharedTaskUrl() : getProjectUrl()
  }

  // User has not completed onboarding
  return `/onboarding?projectId=${prevBoard?.id}&teamTitle=${
    prevBoard?.team?.title || 'MyTeam'
  }&id=${prevBoard?.team?.id || ''}${sharedTask ? `&shareId=${sharedTask.id}` : ""}`
}

// Debug endpoint to see stored codes (remove in production)
export async function GET() {
  const stats = await VerificationCodeService.getStats()
  
  return NextResponse.json({
    stats,
    currentTime: new Date().toISOString()
  })
}
