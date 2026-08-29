import React from 'react';
import { cn } from '@/utils/undoActions/helperFuncs';
import { openGmail, openOutlook } from '@/utils/emailClients';

interface EmailVerificationContentProps {
  email?: string;
  isResending: boolean;
  errorMessage: string;
  onResend: () => void;
}

/**
 * Shared component for email verification UI
 * Displays the verification prompt with email client buttons
 */
export const EmailVerificationContent: React.FC<EmailVerificationContentProps> = ({
  email,
  isResending,
  errorMessage,
  onResend,
}) => {
  return (
    <>
      {/* Envelope Icon */}
      <div className="mb-8 flex justify-center">
        <div className="w-20 h-20 rounded-lg bg-white/5 flex items-center justify-center">
          <svg
            className="w-10 h-10 text-blue-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        </div>
      </div>

      {/* Heading */}
      <h1 className="text-display sm:text-4xl font-bold text-white mb-2">
        Verify Your Email
      </h1>
      <p className="text-subheading text-white mb-12">
        To Activate Your Free Trial
      </p>

      {/* Email Client Buttons */}
      <div className="flex flex-col sm:flex-row gap-4 mb-12 justify-center">
        {/* Gmail Button */}
        <button
          onClick={openGmail}
          className="flex flex-col items-center gap-3 px-10 py-4 hover:bg-white/10 rounded-lg transition-colors cursor-pointer !border-thin border-transparent hover:border-white/20"
        >
          <span className="text-white text-subheading font-medium">Open Gmail</span>
          {/* Gmail Logo */}
          <svg xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width="100" height="100" viewBox="0 0 48 48">
            <path fill="#e0e0e0" d="M5.5,40.5h37c1.933,0,3.5-1.567,3.5-3.5V11.543c0-1.933-1.567-3.5-3.5-3.5h-37	c-1.933,0-3.5,1.567-3.5,3.5V37C2,38.933,3.567,40.5,5.5,40.5z"></path><path fill="#d9d9d9" d="M44.482,12.759L24,27.763L3.518,12.758c0,0-0.095-0.066-0.236-0.182L26,40.5h16.5 c1.933,0,3.5-1.567,3.5-3.5V11.441c0-0.102-0.021-0.197-0.03-0.296C45.816,12.262,44.482,12.759,44.482,12.759z"></path><path fill="#eee" d="M6.745,40.5H42.5c1.933,0,3.5-1.567,3.5-3.5V11.5L6.745,40.5z"></path><path fill="#e0e0e0" d="M25.745,40.5H42.5c1.933,0,3.5-1.567,3.5-3.5V11.5L18.771,31.616L25.745,40.5z"></path><path fill="#ca3737" d="M3.603,12.759c0,0-1.334-0.938-1.488-2.055c-0.008,0.099-0.03,0.195-0.03,0.296 L2,11.473v17.799V37c0,1.933,1.567,3.5,3.5,3.5H7V15.247L3.603,12.759z"></path><path fill="#ca3737" d="M45.97,11.145c-0.154,1.117-1.488,1.614-1.488,1.614L41,15.31V40.5h1.5 c1.933,0,3.5-1.567,3.5-3.5v-7.729v-17.83C46,11.34,45.979,11.244,45.97,11.145z"></path><path fill="#bcbcbc" d="M3.42,13.31l20.623,14.973L44.665,13.31c0,0,0.937-0.661,1.335-1.531v-0.228	c-0.012-1.996-1.569-3.51-3.5-3.5h-37c-1.933,0-3.5,1.567-3.5,3.5v0.009C2.323,12.536,3.42,13.31,3.42,13.31z"></path><g><path fill="#f5f5f5" d="M42.5,8H24H5.5C3.567,8,2,9.536,2,11.5c0,1.206,1.518,2.258,1.518,2.258L24,28.256 l20.482-14.497c0,0,1.518-1.053,1.518-2.258C46,9.536,44.433,8,42.5,8z"></path><path fill="#e84f4b" d="M43.246,8.082L24,21.5L4.754,8.082C3.18,8.419,2,9.797,2,11.5 c0,1.206,1.518,2.258,1.518,2.258L24,28.256l20.482-14.497c0,0,1.518-1.053,1.518-2.258C46,9.797,44.82,8.419,43.246,8.082z"></path></g>
          </svg>
        </button>

        {/* Outlook Button */}
        <button
          onClick={openOutlook}
          className="flex flex-col items-center gap-3 px-10 py-4  hover:bg-white/10 rounded-lg transition-colors cursor-pointer !border-thin border-transparent hover:border-white/20"
        >
          <span className="text-white text-subheading font-medium">Open Outlook</span>
          {/* Outlook Logo */}
          <svg xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width="100" height="100" viewBox="0 0 48 48">
            <path fill="#03A9F4" d="M21,31c0,1.104,0.896,2,2,2h17c1.104,0,2-0.896,2-2V16c0-1.104-0.896-2-2-2H23c-1.104,0-2,0.896-2,2V31z"></path><path fill="#B3E5FC" d="M42,16.975V16c0-0.428-0.137-0.823-0.367-1.148l-11.264,6.932l-7.542-4.656L22.125,19l8.459,5L42,16.975z"></path><path fill="#0277BD" d="M27 41.46L6 37.46 6 9.46 27 5.46z"></path><path fill="#FFF" d="M21.216,18.311c-1.098-1.275-2.546-1.913-4.328-1.913c-1.892,0-3.408,0.669-4.554,2.003c-1.144,1.337-1.719,3.088-1.719,5.246c0,2.045,0.564,3.714,1.69,4.986c1.126,1.273,2.592,1.91,4.378,1.91c1.84,0,3.331-0.652,4.474-1.975c1.143-1.313,1.712-3.043,1.712-5.199C22.869,21.281,22.318,19.595,21.216,18.311z M19.049,26.735c-0.568,0.769-1.339,1.152-2.313,1.152c-0.939,0-1.699-0.394-2.285-1.187c-0.581-0.785-0.87-1.861-0.87-3.211c0-1.336,0.289-2.414,0.87-3.225c0.586-0.81,1.368-1.211,2.355-1.211c0.962,0,1.718,0.393,2.267,1.178c0.555,0.795,0.833,1.895,0.833,3.31C19.907,24.906,19.618,25.968,19.049,26.735z"></path>
          </svg>
        </button>
      </div>

      {/* Email Confirmation Text */}
      {email && (
        <p className="text-white/80 text-content mb-2">
          Confirmation email sent to <span className="font-medium">{email}</span>
        </p>
      )}

      {/* Resend Link */}
      <p className="text-white/60 text-content">
        Didn&apos;t receive the email? Check your spam folder or{' '}
        <button
          onClick={onResend}
          disabled={isResending || !email}
          className={cn(
            "text-blue-400 hover:text-blue-300 underline",
            (isResending || !email) && "opacity-50 cursor-not-allowed"
          )}
        >
          {isResending ? 'Sending...' : 'resend verification email'}
        </button>
      </p>

      {errorMessage && (
        <p className="text-red-400 text-content mt-4">{errorMessage}</p>
      )}
    </>
  );
};
