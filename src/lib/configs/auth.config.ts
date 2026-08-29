/**
 * @fileoverview
 * Hypertask Auth Config
 * Centralized configuration for authentication flows, onboarding, and branding.
 * Used by useAuth.tsx and related authentication logic.
 */

import { DEFAULT_THEME_PREFERENCE } from "@/lib/themePreferences";

const authConfig = {
  // Branding and UI
  branding: {
    appName: "Hypertask",
    logoUrl: "/assets/logo.svg", // Update with actual asset path
    primaryColor: "bg-[#6C47FF]", // Hypertask purple
    accentColor: "bg-[#F6F3FF]", // Hypertask light purple
    button: {
      google: {
        bg: "bg-white",
        text: "text-black",
        border: "border border-gray-200",
        hover: "hover:bg-gray-50",
      },
      email: {
        bg: "bg-[#6C47FF]",
        text: "text-white",
        hover: "hover:bg-[#5a3ed6]",
      },
    },
  },

  // Auth providers
  providers: {
    google: {
      enabled: true,
      label: "Continue with Google",
    },
    email: {
      enabled: true,
      label: "Continue with Email",
    },
  },

  // Email link authentication
  emailLink: {
    sendLinkApi: "/api/auth/send-email-link",
    verifyTokenApi: "/api/auth/verify-email-token",
    codeLength: 6,
    resendCooldownSeconds: 30,
    devShowLink: process.env.NODE_ENV === "development",
    linkExpiryMinutes: 15,
    troubleshootingUrl: "https://help.hypertask.ai/help/troubleshooting-email-login-magic-link",
  },

  // Onboarding
  onboarding: {
    skipOnboardingParam: "skipOnboarding",
    shouldSkipInteractiveParam: "shouldSkipInteractive",
    defaultTeamTitle: "MyTeam",
    defaultBoardTitle: "MyBoard",
    defaultCompanyRoleIdx: 0, // index in companyRoleOptions
    defaultCompanySizeIdx: 0, // index in companySizeOptions
    // Signup goes straight to the board (Valentin, 2026-08-02): new users are
    // created onboarded, no /onboarding wizard, no interactive tutorial. A
    // boardless landing renders NoBoardsEmptyState (one-click workspace), so the
    // HTPR-4066 black-board problem this used to guard against is gone. Flip
    // both back to false to restore the wizard.
    shouldSkipInteractive: true,
    skipOnboarding: true,
  },

  // Redirection
  redirect: {
    // Route post-login through "/" so the middleware restores the user's last
    // board from the previousBoard cookie (-> /project?id=N). Targeting bare
    // "/project" bypassed that and dumped users on the first/welcome board.
    afterLogin: "/",
    afterOnboarding: "/onboarding",
    getProjectUrl: (projectId: number, view?: string) =>
      `/project?id=${projectId}${view ? `&view=${view}` : ""}`,
    getOnboardingUrl: (projectId: number, teamTitle: string, teamId: number) =>
      `/onboarding?projectId=${projectId}&teamTitle=${encodeURIComponent(
        teamTitle
      )}&id=${teamId}`,
    getSharedTaskUrl: (projectId: number, uniqueIndex: number) =>
      `/detail/project-${projectId}/${uniqueIndex}`,
  },

  // Cookie settings
  cookies: {
    user: "nookies_user",
    previousBoard: "previousBoard",
    theme: "theme",
    funnel: "funnel",
    funnelTutorialCompleted: "funnel_tutorial_completed",
    isFunnelUser: "is_funnel_user",
    maxAge: 60 * 60 * 24 * 7, // 1 week in seconds
    defaultTheme: DEFAULT_THEME_PREFERENCE,
    options: {
      path: "/",
      secure: () => process.env.NODE_ENV === "production",
      sameSite: "strict" as const,
    },
  },

  // A/B Test variants
  abTest: {
    skipInteractiveTutorial: "skip-interactive-tutorial",
    urlParam: "variant", // URL parameter to read variant from
  },

  // Error messages
  errors: {
    invalidEmail: "Please enter a valid email address",
    emailRequired: "Email is required",
    codeExpired: "This verification code has expired. Please request a new one.",
    codeInvalid: "Invalid verification code. Please enter a 6-digit code.",
    generic: "Verification failed: Please try again.",
    sendLinkFailed: "Failed to send sign-in link",
    tokenVerificationFailed: "Token verification failed",
  },
};

export default authConfig;
