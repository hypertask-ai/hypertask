import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/hooks/General/useAuth'
import authConfig from '@/lib/configs/auth.config'
import { useUTM } from '@/hooks/General/useUTMs'
import { useSearchParams } from 'next/navigation'
import { parseSafeReturnTo, POST_LOGIN_REDIRECT_STORAGE_KEY } from '@/lib/auth/safeReturnTo'
import { authClient } from '@/lib/auth/betterAuthClient'

export type EmailAuthStep = 'form' | 'link-sent' | 'signing-in' | 'code-input'

export interface EmailAuthState {
  email: string
  isLoading: boolean
  errors: {[key: string]: string}
  step: EmailAuthStep
  verificationCode: string
  abTestVariant: string | null
}

export interface EmailAuthHandlers {
  setEmail: (email: string) => void
  setVerificationCode: (code: string) => void
  setStep: (step: EmailAuthStep) => void
  handleSubmit: (e: React.FormEvent) => Promise<void>
  handleVerificationCode: (e: React.FormEvent) => Promise<void>
  resendLink: () => Promise<void>
  enterCodeManually: () => Promise<void>
  resetForm: () => void
}

// Module-level flag to prevent multiple token processing across component remounts
let globalTokenProcessed = false
let globalAccountRecoveryProcessed = false
const PROCESSED_TOKEN_KEY = 'email_token_processed'

export function useEmailAuth(initialEmail = '') {
  // HTPR-4175: the Better Auth magic-link email regressed email login (no code
  // fallback, 5-min expiry, single-use so mail scanners prefetch and burn it).
  // Email login/signup runs on the legacy reusable link+code email again; this
  // gate is separate from NEXT_PUBLIC_BETTER_AUTH_ENABLED so Google + the session
  // bridge stay on Better Auth. Unset => off => legacy flow (the working path).
  const isBetterAuthEnabled = process.env.NEXT_PUBLIC_BETTER_AUTH_EMAIL === '1'
  const [email, setEmail] = useState(initialEmail)
  const [isLoading, setIsLoading] = useState(false)
  const [errors, setErrors] = useState<{[key: string]: string}>({})
  const [step, setStep] = useState<EmailAuthStep>('form')
  const [verificationCode, setVerificationCode] = useState('')
  const [abTestVariant, setAbTestVariant] = useState<string | null>(null)
  const { getUTMData } = useUTM()
  const [isProcessingToken, setIsProcessingToken] = useState(false)
  const searchParams = useSearchParams()
  const { loginWithEmail } = useAuth()
  const accountRecoveryStartedRef = useRef(false)
  const conditionalPasskeyStartedRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (conditionalPasskeyStartedRef.current) return

    const conditionalMediationAvailable =
      window.PublicKeyCredential?.isConditionalMediationAvailable
    if (!conditionalMediationAvailable) return

    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.has('token') || urlParams.has('authError')) return

    conditionalPasskeyStartedRef.current = true

    const signInWithPasskeyAutofill = async () => {
      try {
        if (!(await conditionalMediationAvailable.call(window.PublicKeyCredential))) return

        const { error } = await authClient.signIn.passkey({ autoFill: true })
        if (error) return

        const bridge = await fetch('/api/auth/bridge-legacy-session', {
          method: 'POST',
          credentials: 'include',
        })
        if (!bridge.ok) return

        // Route projectless users to /onboarding, not the black /project page,
        // and honor a stored return path — same as the reverse bridge.
        const { hasProjects } = await bridge
          .json()
          .catch(() => ({ hasProjects: true }))
        const storedRedirect = sessionStorage.getItem(POST_LOGIN_REDIRECT_STORAGE_KEY)
        if (storedRedirect) sessionStorage.removeItem(POST_LOGIN_REDIRECT_STORAGE_KEY)
        window.location.assign(
          storedRedirect ??
            (hasProjects === false ? '/onboarding' : authConfig.redirect.afterLogin),
        )
      } catch {
        // Conditional UI is progressive enhancement; email sign-in stays available.
      }
    }

    void signInWithPasskeyAutofill()
  }, [])

  // Check if this page was loaded from a JWT email token or has AB test variant
  useEffect(() => {
    if (typeof window === 'undefined') return
    
    const urlParams = new URLSearchParams(window.location.search)
    const token = urlParams.get('token')
    
    console.log('🔍 useEmailAuth useEffect - checking for token:', token ? 'found' : 'not found')
    
    if (!token) return
    
    // Check both module-level flag and sessionStorage to prevent multiple calls
    const sessionProcessed = sessionStorage.getItem(PROCESSED_TOKEN_KEY) === token
    if (globalTokenProcessed || sessionProcessed) {
      console.log('⚠️ Token already processed (module or session), skipping', { 
        globalTokenProcessed, 
        sessionProcessed,
        storedToken: sessionStorage.getItem(PROCESSED_TOKEN_KEY),
        currentToken: token.substring(0, 20) + '...'
      })
      return
    }
    
    console.log('🔗 JWT email token detected in URL - starting processing')
    // Mark as processed in both places before async call
    globalTokenProcessed = true
    sessionStorage.setItem(PROCESSED_TOKEN_KEY, token)
    
    const abTestParam = (authConfig as any).abTest?.urlParam || 'variant'
    const variant = urlParams.get(abTestParam)
    
    // Store AB test variant if present
    if (variant) {
      console.log('🧪 AB Test Variant detected:', variant)
      setAbTestVariant(variant)
    }
    
    setIsProcessingToken(true)
    setStep('signing-in')
    completeSignInWithJWT(token, variant)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (isBetterAuthEnabled) return

    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.get('authError') !== 'account_not_found') return

    const pendingEmail = sessionStorage.getItem('ht_pending_ba_email')
    if (!pendingEmail) return

    if (accountRecoveryStartedRef.current || globalAccountRecoveryProcessed) return
    accountRecoveryStartedRef.current = true
    globalAccountRecoveryProcessed = true

    sessionStorage.removeItem('ht_pending_ba_email')
    window.history.replaceState(null, '', window.location.pathname)
    setEmail(pendingEmail)
    setStep('signing-in')

    const recoverAccount = async () => {
      try {
        const response = await fetch('/api/auth/instant-signup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: pendingEmail,
            utmData: getUTMData() || {},
          }),
        })
        const data = await response.json()

        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Account creation failed')
        }

        setStep('link-sent')
      } catch (error) {
        console.error('❌ Failed to recover Better Auth magic-link signup:', error)
        setErrors({ general: 'We couldn\'t find an account for that email and creating one failed. Please try again.' })
        setStep('form')
      }
    }

    recoverAccount()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const validateEmail = () => {
    const newErrors: {[key: string]: string} = {}
    
    if (!email) {
      newErrors.email = 'Email is required'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = 'Please enter a valid email address'
    }
    
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const completeSignInWithJWT = async (token: string, variant: string | null) => {
    try {
      // Don't check isProcessingToken here since we already set it in useEffect
      console.log('🔍 Starting JWT token verification...')
      console.log('🔍 Token (first 50 chars):', token.substring(0, 50) + '...')
      console.log('🔍 Verifying JWT token')
      console.log('🧪 AB Test Variant:', variant)
      console.log('🔍 API endpoint:', authConfig.emailLink.verifyTokenApi)
      
      // Call our API to verify the JWT and get the post-auth user data
      const response = await fetch(authConfig.emailLink.verifyTokenApi, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          token,
          abTestVariant: variant, // Pass AB test variant
          shouldSkipInteractive: authConfig.onboarding.shouldSkipInteractive // Pass skip interactive flag
        }),
      })

      console.log('🔍 API response status:', response.status)
      const data = await response.json()
      console.log('🔍 API response data:', data)

      if (!response.ok || !data.success) {
        console.error('❌ API error:', data)
        throw new Error(data.error || 'Token verification failed')
      }

      console.log('✅ JWT verified, completing sign-in')
      console.log('👤 isNewUser from API:', data.isNewUser)
      console.log('👤 User data from API:', data.user)

      // Complete sign-in using the pre-processed data and cookies from the API
      await loginWithEmail({
        shouldSkipInteractive: authConfig.onboarding.shouldSkipInteractive, 
        skipOnboarding: authConfig.onboarding.skipOnboarding,
        userData: data.user,
        prevBoard: data.prevBoard,
        isNewUser: data.isNewUser, // Use isNewUser from the FIRST API call
        skipDatabaseUpdate: true
      })

      console.log('✅ Login completed successfully')

    } catch (error: any) {
      console.error('❌ Error with JWT sign-in:', error)
      console.error('❌ Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      })
      setIsProcessingToken(false) // Reset on error so user can retry
      
      // Clear the processed flag on error so user can retry
      globalTokenProcessed = false
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(PROCESSED_TOKEN_KEY)
      }
      
      if (error.message.includes('expired')) {
        setErrors({ general: 'This sign-in link has expired. Please request a new one.' })
      } else if (error.message.includes('invalid')) {
        setErrors({ general: 'This sign-in link is invalid. Please request a new one.' })
      } else {
        setErrors({ general: `Sign-in failed: ${error.message || 'Please try again.'}` })
      }
      
      setStep('form')
    }
  }

  const handleVerificationCode = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!verificationCode) {
      setErrors({ code: 'Verification code is required' })
      return
    }
    
    setIsLoading(true)
    setErrors({})
    
    try {
      console.log('🧪 AB Test Variant:', abTestVariant)

      if (isBetterAuthEnabled) {
        const { error } = await authClient.signIn.emailOtp({
          email,
          otp: verificationCode,
        })

        if (error) {
          throw new Error(error.message || 'Code verification failed')
        }

        const bridgeResponse = await fetch('/api/auth/bridge-legacy-session', {
          method: 'POST',
          credentials: 'include',
        })

        if (!bridgeResponse.ok) {
          throw new Error('Unable to complete sign-in. Please try again.')
        }

        window.location.assign(authConfig.redirect.afterLogin)
      } else {
        // Call our API to verify the code and get the post-auth user data
        const response = await fetch('/api/auth/verify-code', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            code: verificationCode,
            email,
            currentBrowserUrl: window.location.href,
            shouldSkipInteractive: false,
            abTestVariant: abTestVariant // Pass AB test variant
          }),
        })

        const data = await response.json()

        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Code verification failed')
        }

        await loginWithEmail({
          userData: data.user,
          prevBoard: data.prevBoard,
          isNewUser: data.isNewUser,
          skipDatabaseUpdate: true
        })
      }

    } catch (error: any) {
      console.error('❌ Error with code sign-in:', error)
      
      if (error.message.includes('expired')) {
        setErrors({ code: 'This verification code has expired. Please request a new one.' })
      } else if (error.message.includes('invalid') || error.message.includes('Invalid code format')) {
        setErrors({ code: 'Invalid verification code. Please enter a 6-digit code.' })
      } else if (error.message.includes('wait')) {
        setErrors({ code: error.message })
      } else {
        setErrors({ code: `Verification failed: ${error.message || 'Please try again.'}` })
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateEmail()) return
    
    setIsLoading(true)
    setErrors({})
    
    try {
      console.log('📧 Sending custom sign-in link to:', email)
      if (isBetterAuthEnabled) {
        sessionStorage.setItem('ht_pending_ba_email', email)
        const { error } = await authClient.signIn.magicLink({
          email,
          callbackURL: authConfig.redirect.afterLogin,
          errorCallbackURL: '/login?authError=account_not_found',
        })

        if (error) {
          throw new Error(error.message || 'Failed to send sign-in link')
        }
      } else {
        const project = searchParams?.get("project");
        const key = searchParams?.get("key");
        const projectId = searchParams?.get("projectId");

        // Get UTM data from cookies
        const utmData = getUTMData()
        const safeReturnTo = parseSafeReturnTo(searchParams?.get('returnTo'))

        // Call our custom email sending API
        const response = await fetch('/api/auth/send-email-link', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email,
            utmData: utmData || {},
            inviteData: {
              project,
              key,
              projectId
            },
            ...(safeReturnTo ? { returnTo: safeReturnTo } : {}),
          }),
        })

        const data = await response.json()

        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Failed to send sign-in link')
        }

        console.log('✅ Sign-in link sent successfully')

        // In development, show the link for easy testing
        if (process.env.NODE_ENV === 'development' && data.devLink) {
          console.log('🔗 Dev link:', data.devLink)
        }
      }
      
      setStep('link-sent')
      
    } catch (error: any) {
      console.error('❌ Error sending sign-in link:', error)
      
      if (error.message.includes('invalid-email')) {
        setErrors({ email: 'Please enter a valid email address.' })
      } else if (error.message.includes('too-many-requests') || error.message.includes('Please wait')) {
        setErrors({ general: error.message || 'Too many requests. Please try again later.' })
      } else if (error.message.includes('already active')) {
        setErrors({ general: 'A verification code is already active for this email. Check your inbox or wait before requesting a new one.' })
      } else {
        setErrors({ general: error.message || 'Failed to send sign-in link. Please try again.' })
      }
    } finally {
      setIsLoading(false)
    }
  }

  const resendLink = async () => {
    if (!email) {
      setErrors({ email: 'Please enter your email address' })
      return
    }
    
    setIsLoading(true)
    setErrors({})
    
    try {
      if (isBetterAuthEnabled) {
        sessionStorage.setItem('ht_pending_ba_email', email)
        const { error } = await authClient.signIn.magicLink({
          email,
          callbackURL: authConfig.redirect.afterLogin,
          errorCallbackURL: '/login?authError=account_not_found',
        })

        if (error) {
          throw new Error(error.message || 'Failed to resend link')
        }
      } else {
        // Get UTM data from cookies
        const utmData = getUTMData()
        const project = searchParams?.get("project");
        const key = searchParams?.get("key");
        const projectId = searchParams?.get("projectId");
        const safeReturnTo = parseSafeReturnTo(searchParams?.get('returnTo'))

        const response = await fetch('/api/auth/send-email-link', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email,
          utmData: utmData || {},
            inviteData: {
              project,
              key,
              projectId
            },
            ...(safeReturnTo ? { returnTo: safeReturnTo } : {}),
          }),
        })

        const data = await response.json()

        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Failed to resend link')
        }
      }

      console.log('✅ Sign-in link resent')
      alert('New sign-in link sent! Check your inbox.')
    } catch (error: any) {
      console.error('❌ Failed to resend link:', error)
      setErrors({ general: error.message || 'Failed to resend link. Please try again.' })
    } finally {
      setIsLoading(false)
    }
  }

  const enterCodeManually = async () => {
    if (!isBetterAuthEnabled) {
      setStep('code-input')
      return
    }

    setIsLoading(true)
    setErrors({})

    try {
      const { error } = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: 'sign-in',
      })

      if (error) {
        throw new Error(error.message || 'Failed to send verification code')
      }

      setStep('code-input')
    } catch (error: any) {
      setErrors({ general: error.message || 'Failed to send verification code. Please try again.' })
    } finally {
      setIsLoading(false)
    }
  }

  const resetForm = () => {
    setStep('form')
    setEmail('')
    setVerificationCode('')
    setErrors({})
  }

  return {
    state: {
      email,
      isLoading,
      errors,
      step,
      verificationCode,
      abTestVariant
    },
    handlers: {
      setEmail,
      setVerificationCode,
      setStep,
      handleSubmit,
      handleVerificationCode,
      resendLink,
      enterCodeManually,
      resetForm
    }
  }
}
