
import { DEFAULT_THEME_PREFERENCE } from "@/lib/themePreferences";

const authConfig = {
  branding: {
    appName: "Hypertask",
    logoUrl: "/assets/logo.svg",
    primaryColor: "bg-[#6C47FF]",
    accentColor: "bg-[#F6F3FF]",
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

  emailLink: {
    sendLinkApi: "/api/auth/send-email-link",
    verifyTokenApi: "/api/auth/verify-email-token",
    codeLength: 6,
    resendCooldownSeconds: 30,
    devShowLink: process.env.NODE_ENV === "development",
    linkExpiryMinutes: 15,
    troubleshootingUrl: "https://help.hypertask.ai/help/troubleshooting-email-login-magic-link",
  },

  onboarding: {
    skipOnboardingParam: "skipOnboarding",
    shouldSkipInteractiveParam: "shouldSkipInteractive",
    defaultTeamTitle: "MyTeam",
    defaultBoardTitle: "MyBoard",
    defaultCompanyRoleIdx: 0,
    defaultCompanySizeIdx: 0,
    shouldSkipInteractive: true,
    skipOnboarding: true,
  },

  redirect: {
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

  cookies: {
    user: "nookies_user",
    previousBoard: "previousBoard",
    theme: "theme",
    funnel: "funnel",
    funnelTutorialCompleted: "funnel_tutorial_completed",
    isFunnelUser: "is_funnel_user",
    maxAge: 60 * 60 * 24 * 7,
    defaultTheme: DEFAULT_THEME_PREFERENCE,
    options: {
      path: "/",
      secure: () => process.env.NODE_ENV === "production",
      sameSite: "strict" as const,
    },
  },

  abTest: {
    skipInteractiveTutorial: "skip-interactive-tutorial",
    urlParam: "variant",
  },

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
