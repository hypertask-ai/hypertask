import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { VerificationCodeService } from '@/lib/services/verificationCodeService'
import { parseSafeReturnTo } from '@/lib/auth/safeReturnTo'
import { getRequestBaseUrl } from '@/lib/auth/requestBaseUrl'
import { sendEmail } from '@/lib/email/sendEmail'

// --------- Config & Helpers ---------
const JWT_ISSUER = process.env.JWT_ISSUER || 'hypertask'
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'email-link'

// Resend configuration
const RESEND_API_KEY = process.env.RESEND_API_KEY
const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@hypertask.ai'

function getJwtSecret() {
  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret) {
    throw new Error('Missing JWT_SECRET env var')
  }
  return jwtSecret
}

async function sendEmailWithLink(to: string, link: string, code: string) {
  if (RESEND_API_KEY) {
    try {
      await sendEmailWithResend(to, link, code)
    } catch (error) {
      console.error('❌ Resend failed:', error)
      throw error
    }
  } else {
    console.log('🔗 Sign-in email skipped because Resend is not configured')
  }
}

async function sendEmailWithResend(to: string, link: string, code: string) {
  if (!RESEND_API_KEY) {
    throw new Error('Resend API key not configured')
  }

  await sendEmail({
    to,
    from: `Hypertask <${EMAIL_FROM}>`,
    subject: 'Sign in to Hypertask',
    html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9fafb; padding: 40px 20px;">
            <div style="background-color: white; border-radius: 12px; padding: 40px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
              <div style="text-align: center; margin-bottom: 32px;">
                <h1 style="color: #111827; font-size: 24px; font-weight: 600; margin: 0;">Sign in to Hypertask</h1>
                <p style="color: #6b7280; font-size: 16px; margin: 16px 0 0 0;">Choose your preferred sign-in method below</p>
              </div>
              
              <!-- Option 1: Magic Link -->
              <div style="margin-bottom: 32px;">
                <h3 style="color: #374151; font-size: 18px; font-weight: 500; margin: 0 0 16px 0;">🎯 Quick Sign-in Link</h3>
                <p style="color: #6b7280; font-size: 14px; margin: 0 0 16px 0;">Click the button below to sign in instantly:</p>
                <div style="text-align: center;">
                  <a href="${link}" 
                     style="background-color: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; font-size: 16px; transition: background-color 0.2s;">
                    Sign In with Link
                  </a>
                </div>
                <p style="color: #9ca3af; font-size: 12px; margin: 12px 0 0 0; text-align: center;">
                  This link expires in 30 minutes
                </p>
              </div>
              
              <!-- Option 2: Verification Code -->
              <div style="margin-bottom: 32px;">
                <h3 style="color: #374151; font-size: 18px; font-weight: 500; margin: 0 0 16px 0;">🔐 Verification Code</h3>
                <p style="color: #6b7280; font-size: 14px; margin: 0 0 16px 0;">Or enter this code manually on the sign-in page:</p>
                <div style="text-align: center; margin: 20px 0;">
                  <div style="background-color: #f3f4f6; border: 2px solid #e5e7eb; border-radius: 8px; padding: 16px; display: inline-block; min-width: 120px;">
                    <span style="font-family: 'Courier New', monospace; font-size: 24px; font-weight: 600; color: #111827; letter-spacing: 4px;">${code}</span>
                  </div>
                </div>
                <p style="color: #9ca3af; font-size: 12px; margin: 12px 0 0 0; text-align: center;">
                  This code expires in 15 minutes
                </p>
              </div>
              
              <!-- Fallback Link -->
              <div style="border-top: 1px solid #e5e7eb; padding-top: 24px; text-align: center;">
                <p style="color: #6b7280; font-size: 14px; margin: 0 0 16px 0;">
                  Having trouble? Copy and paste this link into your browser:
                </p>
                <a href="${link}" style="color: #2563eb; font-size: 14px; word-break: break-all;">${link}</a>
              </div>
              
              <!-- Footer -->
              <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb; text-align: center;">
                <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                  If you didn't request this email, you can safely ignore it.
                </p>
              </div>
            </div>
          </div>
        `,
  })

  console.log('✅ Email sent via Resend with both link and code')
}

function createEmailLoginToken(email: string) {
  const jti = crypto.randomUUID()
  const payload = { sub: email }
  const token = jwt.sign(payload, getJwtSecret(), {
    expiresIn: '15m',           // keep short
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    jwtid: jti,
  })
  return token
}

function generateVerificationCode(): string {
  // Use the service's secure code generation
  return VerificationCodeService.generateCode()
}

// Build URL with UTM parameters
function buildSignInLinkWithUTM(
  baseUrl: string,
  token: string,
  utmData: Record<string, string | undefined>,
  inviteData: { project: string, key: string, projectId: string },
  safeReturnTo: string | null
): string {
  const url = new URL(baseUrl);
  url.searchParams.set('token', token);

  // Add UTM parameters to the URL
  Object.entries(utmData).forEach(([key, value]) => {
    if (value) {
      url.searchParams.set(key, value);
    }
  });
  
  //!!!!VERY IMPORTANT YOU SHOULD READ THIS 
  // There is a key-val pair that is "key": 'randomtokenajsdkahbsdkasd".
  // So make sure to use some other name than key for the other params if youre thinking about using "key". 

  // Add invite parameters to the URL
  Object.entries(inviteData).forEach(([key, value]) => {
    if (value) {
      url.searchParams.set(key, value);
    }
  });
  if (safeReturnTo) {
    url.searchParams.set('returnTo', safeReturnTo);
  }
  return url.toString();
}

// --------- Route Handler ---------
export async function POST(request: NextRequest) {
  try {
    const { email, utmData, inviteData, returnTo: rawReturnTo } = await request.json()

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Email is required' },
        { status: 400 }
      )
    }

    const normalizedEmail = email.trim().toLowerCase()
    console.log('📧 Generating email link and code for:', normalizedEmail)

    // Check rate limiting first
    const rateLimitCheck = VerificationCodeService.isRateLimited(normalizedEmail)
    if (rateLimitCheck.limited) {
      return NextResponse.json(
        { 
          success: false, 
          error: `Please wait ${rateLimitCheck.waitTime} seconds before requesting another code`,
          waitTime: rateLimitCheck.waitTime
        },
        { status: 429 }
      )
    }

    const token = createEmailLoginToken(normalizedEmail)
    const verificationCode = generateVerificationCode()
    
    // Use UTM data from request body (or empty object if not provided)
    const utmParams = utmData && typeof utmData === 'object' ? utmData : {}
    console.log('📊 UTM Data from request body:', utmParams)
    
    const safeReturnTo = parseSafeReturnTo(
      typeof rawReturnTo === 'string' ? rawReturnTo : null
    )

    // Build sign-in link with UTM parameters
    const baseSignInUrl = `${getRequestBaseUrl(request)}/login`
    const signInLink = buildSignInLinkWithUTM(
      baseSignInUrl,
      token,
      utmParams as Record<string, string | undefined>,
      inviteData || {},
      safeReturnTo
    )
    
    // Store the verification code for later verification
    await VerificationCodeService.storeCode(verificationCode, normalizedEmail, 30)

    await sendEmailWithLink(normalizedEmail, signInLink, verificationCode)

    return NextResponse.json({
      success: true,
      message: 'Sign-in email sent with both link and code!',
      // HTPR-4176: never leak the code to the caller in production — anyone could
      // read it here and log in as any user. Dev-only for local testing.
      ...(process.env.NODE_ENV !== 'production' && { verificationCode, devLink: signInLink }),
    })
  } catch (error) {
    console.error('❌ Error generating email link:', error)
    
    // Handle specific error types
    if (error instanceof Error) {
      if (error.message.includes('Please wait')) {
        return NextResponse.json(
          { 
            success: false, 
            error: error.message,
            code: 'RATE_LIMITED'
          },
          { status: 429 }
        )
      }
      
      if (error.message.includes('already active')) {
        return NextResponse.json(
          { 
            success: false, 
            error: 'A verification code is already active for this email',
            code: 'CODE_ALREADY_ACTIVE'
          },
          { status: 409 }
        )
      }
    }
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to generate sign-in email',
        code: 'INTERNAL_ERROR'
      },
      { status: 500 }
    )
  }
}
