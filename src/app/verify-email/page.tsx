'use client'
import { useState, Suspense, useLayoutEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { EmailVerificationContent } from '@/components/EmailVerification/EmailVerificationContent'
import { VerificationStatusDisplay } from '@/components/EmailVerification/VerificationStatusDisplay'
import { useResendVerificationEmail } from '@/hooks/useResendVerificationEmail'
import { useEmailVerificationStatus } from '@/hooks/useEmailVerificationStatus'

const VerifyEmailContent = () => {
  const searchParams = useSearchParams()
  const [email, setEmail] = useState<string>('')
  const { isResending, errorMessage: resendErrorMessage, handleResend } = useResendVerificationEmail()

  // Get token from URL
  const token = searchParams?.get('token')
  const emailParam = searchParams?.get('email')

  // Use unified verification status hook
  const { status, errorMessage, verifyWithToken } = useEmailVerificationStatus({
    token: token || null,
    enablePolling: false,
    initialStatus:"verifying"
  })

  useLayoutEffect(() => {
    if (emailParam) {
      setEmail(emailParam)
    }
  }, [emailParam])

  const handleResendClick = () => {
    handleResend(email)
  }

  return (
    <div className="min-h-screen bg-gradient-dark flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        {status === 'pending' ? (
          <EmailVerificationContent
            email={email}
            isResending={isResending}
            errorMessage={resendErrorMessage}
            onResend={handleResendClick}
          />
        ) : (
          <VerificationStatusDisplay
            status={status}
            errorMessage={errorMessage}
          />
        )}
      </div>
    </div>
  )
}

const VerifyEmailPage = () => {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-dark flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    }>
      <VerifyEmailContent />
    </Suspense>
  )
}

export default VerifyEmailPage

