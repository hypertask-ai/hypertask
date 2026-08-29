import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { VerificationStatus } from '@/hooks/useEmailVerificationStatus'
import useCurrentUser from '@/hooks/General/useCurrentUserCheckFromCookies'

interface VerificationStatusDisplayProps {
  status: VerificationStatus
  errorMessage?: string
  verifiedMessage?: string
  onGoToLogin?: () => void
}

/**
 * Shared component for displaying verification status states
 * (verifying, verified, error)
 */
export const VerificationStatusDisplay: React.FC<VerificationStatusDisplayProps> = ({
  status,
  errorMessage = '',
  verifiedMessage = 'Your email has been successfully verified. Please check your logged-in session on your other device.',
  onGoToLogin,
}) => {
  const router = useRouter()
  const currentUser = useCurrentUser()

  // Redirect logged-in users when verified - middleware will handle the appropriate redirect
  useEffect(() => {
    if (status === 'verified' && currentUser) {
      router.push('/')
    }
  }, [status, currentUser, router])

  const handleGoToLogin = () => {
    if (onGoToLogin) {
      onGoToLogin()
    } else {
      router.push('/login')
    }
  }

  if (status === 'verifying') {
    return (
      <>
        <div className="mb-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-500/20 mb-4">
            <svg
              className="w-8 h-8 text-blue-400 animate-spin"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.75}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </div>
        </div>
        <h1 className="text-heading font-bold text-white mb-2">Verifying your email...</h1>
        <p className="text-gray-400">Please wait while we verify your email address.</p>
      </>
    )
  }

  if (status === 'verified') {
    // If user is already logged in, redirect instead of showing verified status
    if (currentUser) {
      return null // Component will redirect via useEffect
    }

    return (
      <>
        <div className="mb-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/20 mb-4">
            <svg
              className="w-8 h-8 text-green-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.75}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
        </div>
        <h1 className="text-heading font-bold text-white mb-2">Email Verified!</h1>
        <p className="text-gray-400 mb-6">{verifiedMessage}</p>
        <button
          onClick={handleGoToLogin}
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors"
        >
          Go to Login
        </button>
      </>
    )
  }

  if (status === 'error') {
    return (
      <>
        <div className="mb-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-500/20 mb-4">
            <svg
              className="w-8 h-8 text-red-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.75}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
        </div>
        <h1 className="text-heading font-bold text-white mb-2">Verification Failed</h1>
        <p className="text-gray-400 mb-6">{errorMessage}</p>
        <button
          onClick={handleGoToLogin}
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors"
        >
          Go to Login
        </button>
      </>
    )
  }

  return null
}
