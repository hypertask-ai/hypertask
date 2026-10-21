import { attachSignupContext } from '@/lib/analytics/signupIdentityClient'
import { createAuthClient } from 'better-auth/react'
import { emailOTPClient, magicLinkClient, multiSessionClient } from 'better-auth/client/plugins'
import { passkeyClient } from '@better-auth/passkey/client'

export const authClient = createAuthClient({
  fetchOptions: { onRequest: attachSignupContext },
  plugins: [
    magicLinkClient(),
    emailOTPClient(),
    multiSessionClient(),
    passkeyClient(),
  ],
})
