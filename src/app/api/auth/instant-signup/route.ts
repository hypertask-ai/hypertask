import { NextRequest, NextResponse } from 'next/server'
import { createSignupContext, consumeSignupContext } from '@/lib/auth/signupAttributionContext'
import updateUsers from '@/utils/controllers/users/update_or_create_user'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { findUserByEmail } from '@/utils/controllers/users/findUserByEmail'
import { VerificationCodeService } from '@/lib/services/verificationCodeService'
import { provisionFirstWorkspace } from '@/utils/controllers/users/provisionFirstWorkspace'
import { companyRoleOptions, companySizeOptions } from '@/lib/constants/constants'
import { sendEmail } from '@/lib/email/sendEmail'
import { signupAttributionFromHeaders } from '@/lib/telemetry/signupAnalytics'
import { SESSION_COOKIE } from '@/lib/auth/session'

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


function createVerificationToken(email: string) {
  const jti = crypto.randomUUID()
  const payload = { sub: email }
  const token = jwt.sign(payload, getJwtSecret(), {
    expiresIn: '30m',
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
    const { email, utmData, signupContext } = await request.json()

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Email is required' },
        { status: 400 }
      )
    }

    const normalizedEmail = email.trim().toLowerCase()
    console.log('📧 Instant signup for:', normalizedEmail)

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

    const signupContextId = await createSignupContext(signupContext, 1800, request.headers.get("cookie"))
    const existingUser = await findUserByEmail(normalizedEmail)

    if (existingUser) {
      await consumeSignupContext(signupContextId)
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
      return NextResponse.json({
        success: true,
        message: 'Account created successfully! Please check your email to verify your account.',
      })
    }

    const userUpdateResult = await updateUsers(
      normalizedEmail,
      {
        uid: `email_${crypto.randomUUID()}`,
        displayName: normalizedEmail.split('@')[0],
        photoURL: undefined,
      },
      true,
      true,
      false,
      signupAttributionFromHeaders(
        request.headers,
        'email',
        typeof utmData?.utm_source === 'string' ? utmData.utm_source : undefined,
      ),
      signupContextId,
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

    if (userUpdateResult.res.isNewUser) {
      try {
        console.log('🚀 Completing onboarding step 1 for instant signup user')
        const onboardingResult = await provisionFirstWorkspace(
          userData as any,
          request.cookies.get(SESSION_COOKIE)?.value,
          'MyTeam',
          'MyBoard',
          companySizeOptions[0],
          companyRoleOptions[0]
        )
        console.log('✅ Onboarding step 1 completed:', onboardingResult)
      } catch (onboardingError) {
        console.error('⚠️ Failed to complete onboarding step 1:', onboardingError)
      }
    }

    const utmParams = utmData && typeof utmData === 'object' ? utmData : {}
    console.log('📊 UTM Data for instant signup:', utmParams)

    const verificationToken = createVerificationToken(normalizedEmail)

    const baseVerificationUrl = `${process.env.NEXT_PUBLIC_BASEURL ?? 'https://app.hypertask.ai'}/verify-email`
    const verificationLink = buildVerificationLinkWithUTM(baseVerificationUrl, verificationToken, utmParams as Record<string, string | undefined>)

    try {
      await sendVerificationEmail(normalizedEmail, verificationLink)
    } catch (emailError) {
      console.error('⚠️ Failed to send verification email:', emailError)
    }

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
