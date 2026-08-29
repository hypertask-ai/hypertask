"use client";
import { useAuth } from "@/hooks/General/useAuth";
import useFunnelCookies from "@/hooks/MultiPages/useFunnelCookies";
import { useSearchParams } from "next/navigation";
import React from "react";
import { cn } from "@/utils/undoActions/helperFuncs";
import authConfig from "@/lib/configs/auth.config";
import { authClient } from "@/lib/auth/betterAuthClient";

interface LoginButtonProps {
  size?: "small" | "normal";
  className?: string;
  iconClassName?: string;
  label?: string;
  labelClassName?: string;
  align?: "center" | "start";
}

const LoginButton = ({
  size = "normal",
  className,
  iconClassName,
  label = "Sign in with Google",
  labelClassName,
  align = "center",
}: LoginButtonProps) => {
  const { loginWithGoogle } = useAuth();
  const searchParams = useSearchParams();
  const { isFunnelUserAndTutorialCompleted } = useFunnelCookies();

  const googleLogin = () => {
    // Check if this is an OAuth flow
    const hasOAuthParams = searchParams?.has('client_id') && searchParams?.has('redirect_uri');
    
    // If the user is coming from funnel and has completed the tutorial, skip interactive onboarding
    // Also skip for OAuth flows
    const shouldSkipInteractive =
      hasOAuthParams ||
      isFunnelUserAndTutorialCompleted || 
      authConfig.onboarding.shouldSkipInteractive ||
      searchParams?.get("shouldSkipInteractive") === "true";

    // Skip onboarding for OAuth flows
    const skipOnboarding = hasOAuthParams || authConfig.onboarding.skipOnboarding;

    if (process.env.NEXT_PUBLIC_BETTER_AUTH_ENABLED === "1") {
      void authClient.signIn.social({
        provider: "google",
        callbackURL: authConfig.redirect.afterLogin,
        errorCallbackURL: "/login?authError=google_signup_disabled",
      });
      return;
    }

    loginWithGoogle(
      undefined,
      shouldSkipInteractive,
      skipOnboarding
    );
  };

  // Adjust styles based on size
  const paddingY = size === "small" ? "py-1.5" : "py-2";
  const paddingX = size === "small" ? "px-7 sm:px-4" : "px-14 sm:px-7";
  const fontSize =
    size === "small"
      ? "text-content sm:text-content"
      : "text-emphasis sm:text-emphasis sm:text-subheading";
  const iconSize = size === "small" ? "h-6 sm:h-7" : "h-8 sm:h-9";

  return (
    <button
      type="button"
      id="login-button"
      onClick={googleLogin}
      className={cn(
        paddingY,
        align === "start" ? "w-full justify-start sm:w-fit" : "w-full justify-center sm:w-fit",
        paddingX,
        "text-subheading text-black bg-[#ffffff] rounded-md flex items-center gap-3 cursor-pointer",
        className
      )}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        x="0px"
        y="0px"
        className={cn(iconSize, iconClassName)}
        viewBox="0 0 48 48"
      >
        <path
          fill="#fbc02d"
          d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12	s5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24s8.955,20,20,20	s20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"
        ></path>
        <path
          fill="#e53935"
          d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039	l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"
        ></path>
        <path
          fill="#4caf50"
          d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36	c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"
        ></path>
        <path
          fill="#1565c0"
          d="M43.611,20.083L43.595,20L42,20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571	c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"
        ></path>
      </svg>
      <span className={cn(fontSize, "font-medium whitespace-nowrap", labelClassName)}>
        {label}
      </span>
    </button>
  );
};

export default LoginButton;
