import { useState, useEffect, useCallback, useRef } from 'react'
import { useRecoilState } from '@/lib/state'
import { currentUserAtom } from '@/store'
import { IUser } from '@/models/model'
import axios from 'axios'

export type VerificationStatus = 'pending' | 'verifying' | 'verified' | 'error'

interface UseEmailVerificationStatusOptions {
  userId?: number
  token?: string | null
  onVerified?: () => void
  enablePolling?: boolean
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
  const processedToken = useRef<string | null>(null)

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

    checkVerificationStatus()

    const interval = setInterval(checkVerificationStatus, pollingInterval)

    return () => {
      clearInterval(interval)
    }
  }, [userId, currentUser, enablePolling, pollingInterval, onVerified, updateUserVerificationStatus])

  useEffect(() => {
    if (token) {
      if (processedToken.current === token) return
      processedToken.current = token
      verifyWithToken(token)
    } else if (!enablePolling) {
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

