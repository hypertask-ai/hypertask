import { NextRequest, NextResponse } from 'next/server'
import updateUsers from '@/utils/controllers/users/update_or_create_user'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import prisma from '@/lib/prisma'
import { VerificationCodeService } from '@/lib/services/verificationCodeService'
import { CompleteOnboardingFirstStep } from '@/utils/controllers/users/completeOnboardingStep'
import { companyRoleOptions, companySizeOptions } from '@/lib/constants/constants'
import { sendEmail } from '@/lib/email/sendEmail'

// Separate audience for verification tokens
const JWT_VERIFICATION_AUDIENCE = process.env.JWT_VERIFICATION_AUDIENCE || 'email-verification'

const JWT_ISSUER = process.env.JWT_ISSUER || 'hypertask'
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'email-link'

const RESEND_API_KEY = process.env.RESEND_API_KEY
const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@hypertask.ai'

function getJwtSecret() {
  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret) {
    throw new Error('Missing JWT_SECRET env var')
  }
  return jwtSecret
}

// HTPR-4815: a login-token helper lived here and minted a credential that was
// handed straight back to an unauthenticated caller. Deleted rather than
// left unused, so nobody wires it back into a response. Logging in still happens
// the only safe way: through the verification link emailed below.

function createVerificationToken(email: string) {
  const jti = crypto.randomUUID()
  const payload = { sub: email }
  const token = jwt.sign(payload, getJwtSecret(), {
    expiresIn: '30m', // Longer expiry for verification
    issuer: JWT_ISSUER,
    audience: JWT_VERIFICATION_AUDIENCE,
    jwtid: jti,
  })
  return token
}


async function sendVerificationEmail(to: string, link: string) {
  if (!RESEND_API_KEY) {
    console.log('🔗 Verification link (no Resend configured):', link)
    return
  }

  await sendEmail({
    to,
    from: `Hypertask <${EMAIL_FROM}>`,
    subject: 'Verify your email - Hypertask',
    html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9fafb; padding: 40px 20px;">
            <div style="background-color: white; border-radius: 12px; padding: 40px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
              <div style="text-align: center; margin-bottom: 32px;">
                <h1 style="color: #111827; font-size: 24px; font-weight: 600; margin: 0;">Verify Your Email</h1>
                <p style="color: #6b7280; font-size: 16px; margin: 16px 0 0 0;">Please verify your email address to continue using Hypertask</p>
              </div>
              
              <div style="margin-bottom: 32px;">
                <p style="color: #6b7280; font-size: 14px; margin: 0 0 24px 0; text-align: center;">
                  Click the button below to verify your email address. Once verified, check your logged-in session on your other device.
                </p>
                <div style="text-align: center;">
                  <a href="${link}" 
                     style="background-color: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; font-size: 16px;">
                    Verify Email
                  </a>
                </div>
                <p style="color: #9ca3af; font-size: 12px; margin: 12px 0 0 0; text-align: center;">
                  This link expires in 30 minutes
                </p>
              </div>
              
              <div style="border-top: 1px solid #e5e7eb; padding-top: 24px; text-align: center;">
                <p style="color: #6b7280; font-size: 14px; margin: 0 0 16px 0;">
                  Having trouble? Copy and paste this link into your browser:
                </p>
                <a href="${link}" style="color: #2563eb; font-size: 14px; word-break: break-all;">${link}</a>
              </div>
              
              <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb; text-align: center;">
                <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                  If you didn't request this email, you can safely ignore it.
                </p>
              </div>
            </div>
          </div>
        `,
  })

  console.log('✅ Verification email sent via Resend')
}

function buildVerificationLinkWithUTM(baseUrl: string, token: string, utmData: Record<string, string | undefined>): string {
  const url = new URL(baseUrl)
  url.searchParams.set('token', token)

  Object.entries(utmData).forEach(([key, value]) => {
    if (value) {
      url.searchParams.set(key, value)
    }
  })

  return url.toString()
}

export async function POST(request: NextRequest) {
  try {
    const { email, utmData } = await request.json()

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Email is required' },
        { status: 400 }
      )
    }

    const normalizedEmail = email.trim().toLowerCase()
    console.log('📧 Instant signup for:', normalizedEmail)

    // Check rate limiting
    const rateLimitCheck = VerificationCodeService.isRateLimited(normalizedEmail)
    if (rateLimitCheck.limited) {
      return NextResponse.json(
        { 
          success: false, 
          error: `Please wait ${rateLimitCheck.waitTime} seconds before trying again`,
          waitTime: rateLimitCheck.waitTime
        },
        { status: 429 }
      )
    }

    const existingUser = await prisma.user.findFirst({
      where: { email: normalizedEmail },
      select: { uid: true },
    })

    // HTPR-4815: this route is unauthenticated, so for an address that already
    // has an account every line below runs on behalf of a stranger. updateUsers()
    // overwrites displayName with the email local-part and marks the interactive
    // tutorial complete, which means anyone could vandalise an account just by
    // POSTing its email. An existing user needs none of it: they already have an
    // account, so the only thing owed to them is the sign-in link, which reaches
    // the real owner's mailbox and nobody else.
    if (existingUser) {
      try {
        await sendVerificationEmail(
          normalizedEmail,
          buildVerificationLinkWithUTM(
            `${process.env.NEXT_PUBLIC_BASEURL ?? 'https://app.hypertask.ai'}/verify-email`,
            createVerificationToken(normalizedEmail),
            (utmData && typeof utmData === 'object' ? utmData : {}) as Record<string, string | undefined>
          )
        )
      } catch (emailError) {
        console.error('⚠️ Failed to send verification email:', emailError)
      }
      // Deliberately the same body as the new-account path: telling an
      // unauthenticated caller which addresses already exist is free account
      // enumeration.
      return NextResponse.json({
        success: true,
        message: 'Account created successfully! Please check your email to verify your account.',
      })
    }

    // Create user in database with isVerified: false
    // For instant signup, skip both interactive tutorial and onboarding
    // User will see verification modal instead
    const userUpdateResult = await updateUsers(
      normalizedEmail,
      {
        // Only reached when there is no existing account, so always a fresh uid.
        uid: `email_${crypto.randomUUID()}`,
        displayName: normalizedEmail.split('@')[0],
        photoURL: undefined,
      },
      true, // shouldSkipInteractive - skip interactive tutorial
      true, // skipOnboarding - skip onboarding (user will see verification modal instead)
      false // isVerified: false for instant signup
    )

    if (userUpdateResult.status !== 200) {
      console.error('❌ User creation failed:', userUpdateResult)
      return NextResponse.json(
        { 
          success: false, 
          error: 'Failed to create user account',
          code: 'USER_CREATION_FAILED'
        },
        { status: userUpdateResult.status }
      )
    }

    const userData = userUpdateResult.res.user
    if (!userData) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'User data not found',
          code: 'USER_DATA_MISSING'
        },
        { status: 500 }
      )
    }

    // Complete onboarding step 1 for instant signup users
    // This creates team, project, and sets up all prerequisites
    if (userUpdateResult.res.isNewUser) {
      try {
        console.log('🚀 Completing onboarding step 1 for instant signup user')
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

    const utmParams = utmData && typeof utmData === 'object' ? utmData : {}
    console.log('📊 UTM Data for instant signup:', utmParams)

    // Generate verification token (separate from login token)
    const verificationToken = createVerificationToken(normalizedEmail)

    // Build verification link with UTM parameters - point to dedicated verification page
    const baseVerificationUrl = `${process.env.NEXT_PUBLIC_BASEURL ?? 'https://app.hypertask.ai'}/verify-email`
    const verificationLink = buildVerificationLinkWithUTM(baseVerificationUrl, verificationToken, utmParams as Record<string, string | undefined>)

    // Send verification email (only link, no code)
    try {
      await sendVerificationEmail(normalizedEmail, verificationLink)
    } catch (emailError) {
      console.error('⚠️ Failed to send verification email:', emailError)
      // Don't fail the request if email fails - user can still verify later
    }

    // HTPR-4815: this route is unauthenticated and accepts ANY email, including
    // one that already has an account (it reuses that user's uid above). It used
    // to return a ready-to-use email-link token — plus the same token again
    // inside loginUrl — so POSTing a victim's address handed the caller a working
    // login for them: full account takeover from an email address alone.
    //
    // The token only ever reaches the real user through the verification email
    // sent above, so it must never appear in this response. The user object and
    // isNewUser go too: to an unauthenticated caller they are account enumeration
    // and a PII leak for any address you care to guess.
    //
    // Nothing consumed them. The one caller (src/app/login/EmailAuth/useEmailAuth.ts,
    // the Better Auth account-recovery path) reads only `success` and shows
    // "check your email", so this is not a user-visible change.
    const response = NextResponse.json({
      success: true,
      message: 'Account created successfully! Please check your email to verify your account.',
    })

    console.log('✅ Instant signup completed successfully')
    return response

  } catch (error) {
    console.error('❌ Instant signup error:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Something went wrong'
      },
      { status: 500 }
    )
  }
}
