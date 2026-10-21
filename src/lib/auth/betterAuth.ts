import { enqueueOutsideSaveAndProcessSoon } from "@/lib/telemetry/analyticsIntents";
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { emailOTP, magicLink, multiSession } from 'better-auth/plugins'
import { apiKey } from '@better-auth/api-key'
import { dash } from '@better-auth/infra'
import { passkey } from '@better-auth/passkey'
import { createAuthMiddleware, getOAuthState } from 'better-auth/api'
import { consumeGoogleSignupContext, consumeSignupCookie } from '@/lib/auth/signupAttributionContext'
import { recordSignupIdentityLink } from '@/lib/telemetry/signupIdentityLink'
import { randomUUID } from 'crypto'

import { bridgeSessionPlugin } from '@/lib/auth/bridgePlugin'
import authConfig from '@/lib/configs/auth.config'
import { legacyCookiePlugin, newGoogleSignupRequests } from '@/lib/auth/legacyCookiePlugin'
import { sendEmail } from '@/lib/email/sendEmail'
import { MANAGEMENT_KEY_PERMISSIONS } from '@/lib/mcp/managementPermissions'
import prisma from '@/lib/prisma'
import { signupAttributionFromHeaders } from '@/lib/telemetry/signupAnalytics'
import { enqueueSignupCompleted } from '@/lib/telemetry/signupCompleted'
import { provisionNewUser } from '@/utils/controllers/users/provisionNewUser'

const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@hypertask.ai'

const managementApiKeyPlugin = apiKey({
  defaultPrefix: 'htmk_',
  enableSessionForAPIKeys: false,
  requireName: true,
  rateLimit: {
    enabled: false,
  },
  permissions: {
    defaultPermissions: MANAGEMENT_KEY_PERMISSIONS,
  },
  schema: {
    apikey: {
      modelName: 'BetterAuthApiKey',
      fields: {
        referenceId: 'userId',
      },
    },
  },
})

Object.assign(managementApiKeyPlugin.schema.apikey.fields.referenceId, {
  references: {
    model: 'User',
    field: 'id',
    onDelete: 'cascade',
  },
})

async function sendMagicLinkEmail(email: string, url: string) {
  if (!process.env.RESEND_API_KEY) {
    console.log('auth email skipped: no RESEND_API_KEY configured')
    return
  }

  await sendEmail({
    to: email,
    from: `Hypertask <${EMAIL_FROM}>`,
    subject: 'Sign in to Hypertask',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9fafb; padding: 40px 20px;">
        <div style="background-color: white; border-radius: 12px; padding: 40px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #111827; font-size: 24px; font-weight: 600; margin: 0;">Sign in to Hypertask</h1>
          </div>

          <div style="margin-bottom: 32px;">
            <h3 style="color: #374151; font-size: 18px; font-weight: 500; margin: 0 0 16px 0;">🎯 Quick Sign-in Link</h3>
            <p style="color: #6b7280; font-size: 14px; margin: 0 0 16px 0;">Click the button below to sign in instantly:</p>
            <div style="text-align: center;">
              <a href="${url}" style="background-color: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; font-size: 16px; transition: background-color 0.2s;">
                Sign In with Link
              </a>
            </div>
            <p style="color: #9ca3af; font-size: 12px; margin: 12px 0 0 0; text-align: center;">This link expires in 5 minutes</p>
          </div>

          <div style="border-top: 1px solid #e5e7eb; padding-top: 24px; text-align: center;">
            <p style="color: #6b7280; font-size: 14px; margin: 0 0 16px 0;">Having trouble? Copy and paste this link into your browser:</p>
            <a href="${url}" style="color: #2563eb; font-size: 14px; word-break: break-all;">${url}</a>
          </div>

          <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb; text-align: center;">
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">If you didn't request this email, you can safely ignore it.</p>
          </div>
        </div>
      </div>
    `,
  })
}

async function sendOTPEmail(email: string, otp: string) {
  if (!process.env.RESEND_API_KEY) {
    console.log('auth email skipped: no RESEND_API_KEY configured')
    return
  }

  await sendEmail({
    to: email,
    from: `Hypertask <${EMAIL_FROM}>`,
    subject: 'Sign in to Hypertask',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9fafb; padding: 40px 20px;">
        <div style="background-color: white; border-radius: 12px; padding: 40px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #111827; font-size: 24px; font-weight: 600; margin: 0;">Sign in to Hypertask</h1>
          </div>

          <div style="margin-bottom: 32px;">
            <h3 style="color: #374151; font-size: 18px; font-weight: 500; margin: 0 0 16px 0;">🔐 Verification Code</h3>
            <p style="color: #6b7280; font-size: 14px; margin: 0 0 16px 0;">Enter this code on the sign-in page:</p>
            <div style="text-align: center; margin: 20px 0;">
              <div style="background-color: #f3f4f6; border: 2px solid #e5e7eb; border-radius: 8px; padding: 16px; display: inline-block; min-width: 120px;">
                <span style="font-family: 'Courier New', monospace; font-size: 24px; font-weight: 600; color: #111827; letter-spacing: 4px;">${otp}</span>
              </div>
            </div>
            <p style="color: #9ca3af; font-size: 12px; margin: 12px 0 0 0; text-align: center;">This code expires in 5 minutes</p>
          </div>

          <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb; text-align: center;">
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">If you didn't request this email, you can safely ignore it.</p>
          </div>
        </div>
      </div>
    `,
  })
}

export const auth = betterAuth({
  appName: 'Hypertask',
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? 'https://app.hypertask.ai',
  onAPIError: { errorURL: '/login' },
  trustedOrigins:
    process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_URL
      ? [
          'https://demo.hypertask.ai',
          `https://${process.env.VERCEL_URL}`,
          ...(process.env.VERCEL_BRANCH_URL
            ? [`https://${process.env.VERCEL_BRANCH_URL}`]
            : []),
        ]
      : [
          'https://app.hypertask.ai',
          'https://staging.hypertask.ai',
          'https://demo.hypertask.ai',
        ],
  emailAndPassword: {
    enabled: false,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_ID as string,
      clientSecret: process.env.GOOGLE_SECRET as string,
    },
  },
  user: {
    modelName: 'User',
    fields: {
      name: 'displayName',
      image: 'photoURL',
      createdAt: 'joinedAt',
    },
    additionalFields: {
      uid: {
        type: 'string',
        required: false,
        input: false,
      },
    },
  },
  session: {
    modelName: 'BetterAuthSession',
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  account: {
    modelName: 'BetterAuthAccount',
    accountLinking: {
      trustedProviders: ['google'],
    },
  },
  verification: {
    modelName: 'BetterAuthVerification',
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({
          data: {
            ...user,
            uid: `ba_${randomUUID()}`,
          },
        }),
        after: async (user, context) => {
          try {
            const userId = Number(user.id)
            if (!Number.isFinite(userId)) {
              throw new Error(`Invalid Better Auth user id: ${user.id}`)
            }

            const decision = await recordSignupIdentityLink(userId, true, context?.path === '/callback/google'
              ? await consumeGoogleSignupContext(await getOAuthState().catch(() => null))
              : await consumeSignupCookie(context, { method: 'magic_link', email: user.email }),
            context?.request?.headers.get('cookie'))

            await provisionNewUser({
              userId,
              email: user.email,
              displayName: user.name,
              photoURL: user.image,
              stripeCustomerNameEmail: user.email,
              shouldSkipInteractive: authConfig.onboarding.shouldSkipInteractive,
              skipOnboarding: authConfig.onboarding.skipOnboarding,
              isVerified: true,
              createGoogleAccount: context?.path === '/callback/google',
            })

            await enqueueOutsideSaveAndProcessSoon(() => enqueueSignupCompleted(prisma, {
              decision,
              cookieHeader: context?.request?.headers.get('cookie') ?? null,
              userId,
              ...signupAttributionFromHeaders(
                context?.request?.headers,
                context?.path === '/callback/google' ? 'google' : 'email',
              ),
            }))
            if (context?.path === '/callback/google' && context.request) {
              newGoogleSignupRequests.set(context.request, userId)
            }
          } catch (error) {
            console.error('CRITICAL: Better Auth user provisioning failed', {
              userId: user.id,
              email: user.email,
              error,
            })
            throw error
          }
        },
      },
    },
  },
  hooks: {
    after: createAuthMiddleware(async (context) => {
      if (!context.context.newSession) return
      if (context.path === '/callback/google') await consumeGoogleSignupContext(await getOAuthState().catch(() => null))
      await consumeSignupCookie(context)
    }),
  },
  advanced: {
    database: {
      generateId: 'serial',
    },
    ipAddress: {
      ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'],
    },
  },
  plugins: [
    dash(),
    managementApiKeyPlugin,
    bridgeSessionPlugin(),
    multiSession(),
    passkey({
      rpName: 'Hypertask',
      origin: process.env.BETTER_AUTH_URL ?? 'https://app.hypertask.ai',
      schema: { passkey: { modelName: 'Passkey' } },
    }),
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        await sendMagicLinkEmail(email, url)
      },
      storeToken: 'hashed',
    }),
    emailOTP({
      sendVerificationOTP: async ({ email, otp, type }) => {
        if (type !== 'sign-in') return

        await sendOTPEmail(email, otp)
      },
      disableSignUp: true,
      otpLength: 6,
      storeOTP: 'hashed',
    }),
    legacyCookiePlugin(),
  ],
})
