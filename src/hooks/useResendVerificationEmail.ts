import { useState } from 'react';
import axios from 'axios';
import { useFlag } from '@/hooks/useFlag';

interface UseResendVerificationEmailReturn {
  isResending: boolean;
  errorMessage: string;
  handleResend: (email: string) => Promise<void>;
}

export const useResendVerificationEmail = (): UseResendVerificationEmailReturn => {
  const straightBoardFlag = useFlag(HTPR_7553_EMAIL_STRAIGHT_BOARD_FLAG);
  const [isResending, setIsResending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const handleResend = async (email: string) => {
    if (!email) {
      setErrorMessage('Email address is required to resend verification email');
      return;
    }

    setIsResending(true);
    setErrorMessage('');
    
    try {
      const response = await axios.post('/api/auth/send-email-link', {
        email,
        ...(straightBoardFlag ? { resendEmailVerification: true } : {}),
      });

      if (response.data.success) {
        alert('Verification email sent! Please check your inbox.');
        setErrorMessage('');
      } else {
        setErrorMessage(response.data.error || 'Failed to resend email');
      }
    } catch (error: any) {
      console.error('Resend error:', error);
      setErrorMessage(
        error.response?.data?.error || 'Failed to resend verification email. Please try again.'
      );
    } finally {
      setIsResending(false);
    }
  };

  return {
    isResending,
    errorMessage,
    handleResend,
  };
};

