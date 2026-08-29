'use client'

import { useEmailAuth } from './EmailAuth/useEmailAuth'
import { EmailForm, LinkSent, CodeInput, SigningIn, EmailAuthStyleConfig } from './EmailAuth/EmailAuthComponents'

interface EmailAuthProps {
  styleConfig?: EmailAuthStyleConfig
  initialEmail?: string
}

export default function EmailAuth({ styleConfig, initialEmail }: EmailAuthProps = {}) {
  const { state, handlers } = useEmailAuth(initialEmail)

  if (state.step === 'signing-in') {
    return <SigningIn state={state} handlers={handlers} styleConfig={styleConfig} />
  }

  if (state.step === 'code-input') {
    return <CodeInput state={state} handlers={handlers} styleConfig={styleConfig} />
  }

  if (state.step === 'link-sent') {
    return <LinkSent state={state} handlers={handlers} styleConfig={styleConfig} />
  }

  return <EmailForm state={state} handlers={handlers} styleConfig={styleConfig} />
}

// Re-export types and components for convenience
export { useEmailAuth } from './EmailAuth/useEmailAuth'
export type { EmailAuthStyleConfig } from './EmailAuth/EmailAuthComponents'
export { EmailForm, LinkSent, CodeInput, SigningIn } from './EmailAuth/EmailAuthComponents'
