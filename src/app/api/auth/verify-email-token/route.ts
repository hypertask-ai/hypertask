import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import update_or_create_user from '@/utils/controllers/users/update_or_create_user'
import { IProject, ITaskShare } from '@/models/model'
import authConfig from '@/lib/configs/auth.config'
import autoJoinByEmailDomain from '@/utils/controllers/users/autoJoinByEmailDomain'
import { CompleteOnboardingFirstStep } from '@/utils/controllers/users/completeOnboardingStep'
import { companyRoleOptions, companySizeOptions } from '@/lib/constants/constants'
import prisma from '@/lib/prisma'
import { SESSION_COOKIE, SESSION_TTL_SECONDS, clearBetterAuthSessionCookies, sessionCookieOptions, signSession } from '@/lib/auth/session'
import { getRequestBaseUrl } from '@/lib/auth/requestBaseUrl'
import { adoptGuestBoards } from '@/utils/controllers/demo/adoptGuestBoards'
import { slimUserForCookie } from '@/lib/auth/slimUserCookie'
import { seedResponseThemeCookie } from '@/lib/auth/themeCookie'

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

    // Use shouldSkipInteractive from request, or fall back to config default
    const skipInteractive = shouldSkipInteractive !== undefined 
      ? shouldSkipInteractive 
      : authConfig.onboarding.shouldSkipInteractive

    console.log('🧪 AB Test Variant (email link):', abTestVariant)
    console.log('⏭️  Should Skip Interactive (email link):', skipInteractive)

    let email: string
    let isVerificationToken = false // Track if this is a verification token (from email) vs login token (from instant signup)
    try {
      const jwtSecret = getJwtSecret()
      // Try verification audience first (for email verification links)
      let decoded: jwt.JwtPayload
      try {
        decoded = jwt.verify(token, jwtSecret, {
          issuer: JWT_ISSUER,
          audience: JWT_VERIFICATION_AUDIENCE,
        }) as jwt.JwtPayload
        isVerificationToken = true // This is a verification token from email
        console.log('✅ Verified as email verification token')
      } catch {
        // Fall back to email-link audience (for login tokens from instant signup)
        decoded = jwt.verify(token, jwtSecret, {
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        }) as jwt.JwtPayload
        isVerificationToken = false // This is a login token, don't change verification status
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

    // Update user in database (EXACTLY like verify-code route)
    // For instant signup users, preserve their onboarding settings
    // Check if user already exists and has specific onboarding settings
    const existingUser = await prisma.user.findFirst({
      where: { email },
      include: { UserSetting: true },
    })
    
    // If user exists and isVerified is false, they're from instant signup
    // Preserve their onboarding settings (they should skip onboarding)
    const shouldSkipOnboarding = existingUser?.UserSetting?.onboardingTourStatus ?? authConfig.onboarding.skipOnboarding
    
    // Only set isVerified to true if this is a verification token (from email)
    // For login tokens (from instant signup), preserve existing verification status
    const shouldSetVerified = isVerificationToken ? true : (existingUser?.UserSetting?.isVerified ?? true)
    
    const userUpdateResult = await update_or_create_user(
      email,
      {
        uid: existingUser?.uid ?? `email_${crypto.randomUUID()}`,
        displayName: existingUser?.displayName || email.split('@')[0],
        photoURL: existingUser?.photoURL,
      },
      skipInteractive, // shouldSkipInteractive from request or config
      shouldSkipOnboarding, // Preserve existing onboarding status for instant signup users
      shouldSetVerified // Only set verified if this is a verification token
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

    // Only set isVerified to true if this is a verification token (from email link)
    // If it's a login token (from instant signup), keep the existing verification status
    if (isVerificationToken && userData.UserSetting) {
      console.log('📧 Email verification token - setting isVerified to true')
      await prisma.userSetting.update({
        where: { id: userData.UserSetting.id },
        data: { isVerified: true },
      })
      // Keep the Better Auth column in sync, or a user who verifies by link
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

    // Auto-provision a team/board for brand-new users so they land on a real
    // board instead of the empty state, matching instant-signup's behavior.
    if (userUpdateResult.res.isNewUser && authConfig.onboarding.skipOnboarding) {
      try {
        console.log('🚀 Completing onboarding step 1 for new email-link user')
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

    // Get user's projects (EXACTLY like verify-code route)
    const prevBoard = await getProjects(userData!.id, getRequestBaseUrl(request))
    console.log('📋 User projects fetched (email link):', prevBoard)

    // Create response with redirect URL following useAuth.tsx logic
    const response = NextResponse.json({
      success: true,
      user: userData, // Pass the full user data from database
      prevBoard: prevBoard, // Pass the project data
      isNewUser: userUpdateResult.res.isNewUser, // Pass the isNewUser flag
      redirectUrl: getRedirectUrl(userData, prevBoard, false, abTestVariant, undefined, undefined, userUpdateResult.res.isNewUser), // false = not mobile
      message: 'Email link verified and signed in successfully!',
      abTestVariant: abTestVariant // Pass through for client-side tracking
    })

    // Set authentication cookies EXACTLY like verify-code route
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

      // Set previous board cookie if we have one (EXACTLY like verify-code route)
      if (prevBoard?.id) {
        response.cookies.set('previousBoard', `project-${prevBoard.id}|&|`, {
          httpOnly: false,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 600 * 60 * 24 * 7, // 1 week
          path: '/'
        })
        console.log('✅ Previous board cookie set (email link):', `project-${prevBoard.id}`)
      }

      // Track the source for analytics
      response.cookies.set('signup_source', 'email_link', {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7, // 7 days
        path: '/'
      })

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

// Helper functions from useAuth.tsx (same as verify-code route)
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

  // Shared task URL generation helper
  const getSharedTaskUrl = () =>
    sharedTask
      ? `/detail/project-${sharedTask.projectId}/${sharedTask.task?.uniqueIndex}`
      : ""

  // Project URL with optional view parameter
  const getProjectUrl = () =>
    `/project?id=${prevBoard?.id}${view ? `&view=${view}` : ""}`

  // User has completed all onboarding steps
  if (onboardingTourStatus) {
    return sharedTask ? getSharedTaskUrl() : getProjectUrl()
  }

  // User has not completed onboarding
  return `/onboarding?projectId=${prevBoard?.id}&teamTitle=${
    prevBoard?.team?.title || 'MyTeam'
  }&id=${prevBoard?.team?.id || ''}${sharedTask ? `&shareId=${sharedTask.id}` : ""}`
}
