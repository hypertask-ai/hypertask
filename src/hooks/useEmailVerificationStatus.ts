import { useState, useEffect, useCallback } from 'react'
import { useRecoilState } from '@/lib/state'
import { currentUserAtom } from '@/store'
import { IUser } from '@/models/model'
import axios from 'axios'

export type VerificationStatus = 'pending' | 'verifying' | 'verified' | 'error'

interface UseEmailVerificationStatusOptions {
  /** User ID for polling verification status (for modal) */
  userId?: number
  /** Token to verify (for verify-email page) */
  token?: string | null
  /** Callback when verification succeeds */
  onVerified?: () => void
  /** Whether to poll for verification status */
  enablePolling?: boolean
  /** Polling interval in milliseconds (default: 3000) */
  pollingInterval?: number
  initialStatus?: VerificationStatus
}

interface UseEmailVerificationStatusReturn {
  status: VerificationStatus
  errorMessage: string
  setErrorMessage: (message: string) => void
  verifyWithToken: (token: string) => Promise<void>
  updateUserVerificationStatus: (isVerified: boolean) => void
}

/**
 * Unified hook for managing email verification status
 * Handles both token verification (for verify-email page) and polling (for modal)
 */
export const useEmailVerificationStatus = (
  options: UseEmailVerificationStatusOptions = {}
): UseEmailVerificationStatusReturn => {
  const {
    userId,
    token,
    onVerified,
    enablePolling = false,
    pollingInterval = 3000,
    initialStatus ="pending"
  } = options

  const [currentUser, setCurrentUser] = useRecoilState(currentUserAtom)
  const [status, setStatus] = useState<VerificationStatus>(initialStatus)
  const [errorMessage, setErrorMessage] = useState<string>('')

  /**
   * Update currentUser atom with verification status
   */
  const updateUserVerificationStatus = useCallback(
    (isVerified: boolean) => {
      setCurrentUser((prevUser: IUser | null) => {
        if (!prevUser) return prevUser
        return {
          ...prevUser,
          UserSetting: {
            ...prevUser.UserSetting,
            isVerified,
          },
        }
      })
    },
    [setCurrentUser]
  )

  /**
   * Verify email with token (for verify-email page)
   */
  const verifyWithToken = useCallback(
    async (verificationToken: string) => {
      setStatus('verifying')
      setErrorMessage('')

      try {
        const response = await axios.post('/api/auth/verify-email-token', {
          token: verificationToken,
          shouldSkipInteractive: true,
        })

        if (response.data.success) {
          setStatus('verified')
          updateUserVerificationStatus(true)
          onVerified?.()
        } else {
          setStatus('error')
          setErrorMessage(response.data.error || 'Verification failed')
        }
      } catch (error: any) {
        console.error('Verification error:', error)
        setStatus('error')
        setErrorMessage(
          error.response?.data?.error || 'Failed to verify email. Please try again.'
        )
      }
    },
    [onVerified, updateUserVerificationStatus]
  )

  /**
   * Poll for verification status (for modal)
   */
  useEffect(() => {
    if (!enablePolling || !userId || !currentUser) return

    const checkVerificationStatus = async () => {
      try {
        const response = await axios.get(
          `/api/users/check-verification?userId=${userId}`
        )

        if (response.data.isVerified) {
          updateUserVerificationStatus(true)
          setStatus('verified')
          onVerified?.()
        }
      } catch (error) {
        console.error('Error checking verification status:', error)
      }
    }

    // Check immediately
    checkVerificationStatus()

    // Then poll at interval
    const interval = setInterval(checkVerificationStatus, pollingInterval)

    return () => {
      clearInterval(interval)
    }
  }, [userId, currentUser, enablePolling, pollingInterval, onVerified, updateUserVerificationStatus])

  /**
   * Handle token verification (for verify-email page)
   */
  useEffect(() => {
    if (token) {
      verifyWithToken(token)
    } else if (!enablePolling) {
      // If no token and not polling, set to pending
      setStatus('pending')
    }
  }, [token, verifyWithToken, enablePolling])

  return {
    status,
    errorMessage,
    setErrorMessage,
    verifyWithToken,
    updateUserVerificationStatus,
  }
}

