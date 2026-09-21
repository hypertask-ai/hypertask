import { useState } from 'react';
import axios from 'axios';

interface UseResendVerificationEmailReturn {
  isResending: boolean;
  errorMessage: string;
  handleResend: (email: string) => Promise<void>;
}

/**
 * Hook for resending verification emails
 */
export const useResendVerificationEmail = (): UseResendVerificationEmailReturn => {
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
      });

      if (response.data.success) {
        // Show success message (you could use a toast here)
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

