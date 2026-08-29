import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { emailOTP, magicLink, multiSession } from 'better-auth/plugins'
import { apiKey } from '@better-auth/api-key'
import { dash } from '@better-auth/infra'
import { passkey } from '@better-auth/passkey'
import { randomUUID } from 'crypto'

import { bridgeSessionPlugin } from '@/lib/auth/bridgePlugin'
import authConfig from '@/lib/configs/auth.config'
import { legacyCookiePlugin } from '@/lib/auth/legacyCookiePlugin'
import { sendEmail } from '@/lib/email/sendEmail'
import { MANAGEMENT_KEY_PERMISSIONS } from '@/lib/mcp/managementPermissions'
import prisma from '@/lib/prisma'
import { provisionNewUser } from '@/utils/controllers/users/provisionNewUser'

const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@hypertask.ai'

const managementApiKeyPlugin = apiKey({
  defaultPrefix: 'htmk_',
  enableSessionForAPIKeys: false,
  requireName: true,
  // MCP routes already enforce the shared per-token Redis rate limit.
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

// This configuration only creates user-owned keys. Marking the polymorphic
// plugin field as a user reference lets Better Auth convert our serial User.id
// to/from its string API representation and matches the Prisma cascade relation.
// This mutates undocumented plugin internals, so @better-auth/api-key is pinned
// to an exact version in package.json — re-verify this shape on every bump.
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
  // Vercel preview deployments serve from *.vercel.app while BETTER_AUTH_URL
  // stays app.hypertask.ai, so the origin check 403s every POST there. Trust
  // the deployment's own host on previews only; production stays strict.
  // demo.hypertask.ai is the isolated-cookie host for the anonymous demo
  // (HTPR-4303); its guest bridge-session POSTs must not be origin-rejected.
  // Cookies are host-only, so this host still cannot touch an app.hypertask.ai
  // session. app.hypertask.ai/staging listed explicitly so the array never
  // narrows the origins production already trusts.
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
    // uid is a legacy NOT NULL column filled by the create.before hook below;
    // without this declaration the adapter strips unknown fields and the
    // insert fails with "Argument uid is missing".
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
    // 30-day rolling login. Default is 7 days, which had users re-authenticating
    // roughly weekly. expiresIn sets the lifetime; updateAge refreshes the token
    // on each day of use so active users effectively stay logged in.
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  account: {
    modelName: 'BetterAuthAccount',
    // emailVerified was backfilled 2026-07-11 (HTPR-4159): 860/995 users, the
    // rest are instant-signups who never proved email ownership. The default
    // requireLocalEmailVerified gate now correctly blocks linking a Google
    // account onto an unverified local account (pre-registration takeover);
    // those users fall back to the legacy Google flow unchanged.
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

            await provisionNewUser({
              userId,
              email: user.email,
              displayName: user.name,
              photoURL: user.image,
              stripeCustomerNameEmail: user.email,
              // HTPR-5639: honour the one config both signup paths share.
              // Hardcoding false sent every Google / passkey / magic-link
              // signup through the /onboarding wizard while email-code signups
              // went straight to the board.
              shouldSkipInteractive: authConfig.onboarding.shouldSkipInteractive,
              skipOnboarding: authConfig.onboarding.skipOnboarding,
              isVerified: true,
              createGoogleAccount: context?.path === '/callback/google',
            })
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
  advanced: {
    database: {
      generateId: 'serial',
    },
    // Vercel terminates TLS ahead of us; the client IP arrives in these
    // headers. Without this, rate limiting counts everyone as one IP.
    ipAddress: {
      ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'],
    },
  },
  // HTPR-4146: apiKey defaults to process.env.BETTER_AUTH_API_KEY.
  plugins: [
    dash(),
    managementApiKeyPlugin,
    bridgeSessionPlugin(),
    multiSession(),
    // ponytail: Passkeys are origin-bound, so Vercel previews cannot register or use them; production only.
    passkey({
      rpName: 'Hypertask',
      // rpID defaults to baseURL host (app.hypertask.ai); origin pinned for defense.
      origin: process.env.BETTER_AUTH_URL ?? 'https://app.hypertask.ai',
      schema: { passkey: { modelName: 'Passkey' } },
    }),
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        await sendMagicLinkEmail(email, url)
      },
      // A DB leak must not expose clickable login links (dashboard insight).
      storeToken: 'hashed',
    }),
    emailOTP({
      sendVerificationOTP: async ({ email, otp, type }) => {
        if (type !== 'sign-in') return

        await sendOTPEmail(email, otp)
      },
      disableSignUp: true,
      otpLength: 6,
      // Same rationale as storeToken above.
      storeOTP: 'hashed',
    }),
    legacyCookiePlugin(),
  ],
})
