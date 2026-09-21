"use client";

import { cn } from "@/utils/undoActions/helperFuncs";
import { useRouter, useSearchParams } from "next/navigation";
import {
  FormEvent,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import EmailAuth, { EmailAuthStyleConfig } from "./EmailAuth";
import LoginButton from "./LoginButton";
import authConfig from "@/lib/configs/auth.config";
import { authClient } from "@/lib/auth/betterAuthClient";
import {
  parseSafeReturnTo,
  POST_LOGIN_REDIRECT_STORAGE_KEY,
} from "@/lib/auth/safeReturnTo";

const emailAuthStyleConfig: EmailAuthStyleConfig = {
  container: "w-full",
  input:
    "!h-12 !rounded-full !border !border-[#4c5362] !bg-[#212429] !px-[22px] !py-0 !text-[15px] placeholder:!text-[#8e9093] focus:!border-[#8e9093] focus:!ring-0",
  button:
    "!h-12 !rounded-lg !px-4 !py-0 !text-[15px] !shadow-none focus:!ring-0 focus:!ring-offset-0",
  buttonPrimary: "!bg-[#333B47] !text-white hover:!bg-[#4f5766]",
  buttonSecondary:
    "!border-0 !bg-[#333B47] !text-white hover:!bg-[#4f5766]",
  error: "text-left",
  text: "text-[#8e9093]",
  textSecondary: "text-[#8e9093] hover:text-white",
  heading: "text-white",
};

interface LoginMiddleProps {
  invite?: boolean;
  serifClassName: string;
}

export const LoginMiddle = ({ serifClassName }: LoginMiddleProps) => {
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState("");
  // Native app shell (Capacitor WebView) cannot complete Google OAuth because
  // Firebase's callback never returns to the app, so default to email there.
  const [isAppShell, setIsAppShell] = useState(false);
  const [isPasskeySupported, setIsPasskeySupported] = useState(false);
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    setIsPasskeySupported(
      typeof window !== "undefined" && !!window.PublicKeyCredential,
    );
  }, []);

  // Preserve OAuth query parameters if present.
  const oauthParams = useMemo(() => {
    const params = new URLSearchParams();
    const hasOAuthParams =
      searchParams?.has("client_id") && searchParams?.has("redirect_uri");
    if (hasOAuthParams) {
      searchParams?.forEach((value, key) => {
        params.set(key, value);
      });
    }
    return params;
  }, [searchParams]);

  const hasOAuthParams = oauthParams.toString().length > 0;

  const handlePasskeySignIn = async () => {
    setPasskeyError(null);
    setIsPasskeyLoading(true);

    try {
      const { error } = await authClient.signIn.passkey();
      if (error) {
        setPasskeyError(
          error.message || "Passkey sign-in failed. Please try again.",
        );
        return;
      }

      const bridge = await fetch("/api/auth/bridge-legacy-session", {
        method: "POST",
        credentials: "include",
      });
      if (!bridge.ok) {
        setPasskeyError("Unable to complete sign-in. Please try again.");
        return;
      }

      // Resume an in-progress OAuth/CLI authorize flow rather than dropping it.
      if (hasOAuthParams) {
        router.push(`/oauth/authorize?${oauthParams.toString()}`);
        return;
      }

      // Honor a stored post-login return path (e.g. CLI auth), else route by
      // membership the same way the reverse bridge does: projectless users
      // must land on /onboarding, not the black /project page.
      const { hasProjects } = await bridge
        .json()
        .catch(() => ({ hasProjects: true }));
      const storedRedirect = sessionStorage.getItem(
        POST_LOGIN_REDIRECT_STORAGE_KEY,
      );
      if (storedRedirect) {
        sessionStorage.removeItem(POST_LOGIN_REDIRECT_STORAGE_KEY);
      }
      window.location.assign(
        storedRedirect ??
          (hasProjects === false
            ? "/onboarding"
            : authConfig.redirect.afterLogin),
      );
    } catch (error) {
      setPasskeyError(
        error instanceof Error
          ? error.message
          : "Passkey sign-in failed. Please try again.",
      );
    } finally {
      setIsPasskeyLoading(false);
    }
  };

  // Persist CLI auth return path for after sign-in (survives Google redirect in the same tab).
  useEffect(() => {
    if (hasOAuthParams) return;
    const safe = parseSafeReturnTo(searchParams?.get("returnTo"));
    if (safe) {
      sessionStorage.setItem(POST_LOGIN_REDIRECT_STORAGE_KEY, safe);
    }
  }, [hasOAuthParams, searchParams]);

  // Check if the user is already authenticated and redirect to authorize for OAuth flows.
  useEffect(() => {
    if (!hasOAuthParams) return;

    const checkAuth = () => {
      const cookies = document.cookie.split(";");
      const userCookie = cookies.find((cookie) =>
        cookie.trim().startsWith("nookies_user="),
      );

      if (userCookie) {
        try {
          const userData = JSON.parse(
            decodeURIComponent(userCookie.split("=")[1]),
          );
          if (userData?.id && userData?.email) {
            router.push(`/oauth/authorize?${oauthParams.toString()}`);
          }
        } catch {
          // Invalid cookie; keep showing login.
        }
      }
    };

    checkAuth();

    // Also check periodically in case the cookie is set asynchronously.
    const interval = setInterval(checkAuth, 500);
    return () => clearInterval(interval);
  }, [hasOAuthParams, oauthParams, router]);

  // In the native app shell, Google sign-in cannot return to the WebView.
  useEffect(() => {
    if (
      typeof navigator !== "undefined" &&
      navigator.userAgent.includes("HypertaskApp")
    ) {
      setIsAppShell(true);
      setShowEmailForm(true);
    }
  }, []);

  // JWT email tokens and account recovery must open the existing email flow immediately.
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;

    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get("token");

    console.log(
      "🔍 LoginMiddle useLayoutEffect - token:",
      token ? "found" : "not found",
    );
    console.log(
      "🔍 LoginMiddle useLayoutEffect - full URL:",
      window.location.href,
    );

    if (token || urlParams.get("authError") === "account_not_found") {
      console.log(
        "🔗 JWT email token detected in LoginMiddle, showing email form",
      );
      setShowEmailForm(true);
    }
  }, []);

  const openEmailForm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setShowEmailForm(true);
  };

  return (
    <>
      <h1
        className={cn(
          serifClassName,
          "mb-3.5 text-balance text-[clamp(2.5rem,3.2vw,3.25rem)] font-medium leading-[1.08] tracking-[-0.02em] text-white",
        )}
      >
        {hasOAuthParams ? (
          "Authorize MCP Client"
        ) : (
          <>
            Free collaborative project boards for the{" "}
            <em className="font-normal italic">agent&nbsp;era</em>
          </>
        )}
      </h1>
      <p className="mb-9 text-pretty text-[15px] leading-[1.55] text-[#8e9093]">
        {hasOAuthParams
          ? "Sign in to authorize access to your Hypertask account."
          : "AI-driven task management that keeps your team shipping. Free to join, seconds to start."}
      </p>

      {showEmailForm ? (
        <div className="w-full">
          <Suspense
            fallback={
              <div className="animate-pulse space-y-3">
                <div className="h-12 rounded-full bg-[#212429]" />
                <div className="h-12 rounded-lg bg-[#333B47]" />
              </div>
            }
          >
            <EmailAuth
              initialEmail={email}
              styleConfig={emailAuthStyleConfig}
            />
          </Suspense>
          {!isAppShell && (
            <button
              type="button"
              onClick={() => setShowEmailForm(false)}
              className="mt-4 text-[14px] text-[#8e9093] transition-colors hover:text-white"
            >
              ← Back to login options
            </button>
          )}
        </div>
      ) : (
        <>
          {!isAppShell && (
            <LoginButton
              size="small"
              label="Continue with Google"
              className="!h-12 !w-full !gap-2.5 !rounded-lg !bg-white !p-0 !text-[#0e0e0e] transition-colors duration-150 hover:!bg-[#d9d9d9]"
              iconClassName="!h-[18px] !w-[18px]"
              labelClassName="!text-[15px]"
            />
          )}

          <div
            aria-hidden="true"
            className="my-[22px] flex items-center gap-3.5 text-[11px] tracking-[0.12em] text-[#8e9093] before:h-px before:flex-1 before:bg-[rgba(76,83,98,0.55)] after:h-px after:flex-1 after:bg-[rgba(76,83,98,0.55)]"
          >
            OR
          </div>

          <form onSubmit={openEmailForm}>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Enter your personal or work email"
              aria-label="Email address"
              className="mb-3 h-12 w-full rounded-full border border-[#4c5362] bg-[#212429] px-[22px] text-[15px] text-white outline-none transition-colors placeholder:text-[#8e9093] focus:border-[#8e9093]"
            />
            <button
              type="submit"
              className="flex h-12 w-full items-center justify-center rounded-lg bg-[#333B47] text-[15px] font-medium text-white transition-colors duration-150 hover:bg-[#4f5766] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8e9093]"
            >
              Continue with email
            </button>

            {isPasskeySupported && !isAppShell && (
              <button
                type="button"
                onClick={() => void handlePasskeySignIn()}
                disabled={isPasskeyLoading}
                className="mt-3 flex h-12 w-full items-center justify-center rounded-lg bg-[#333B47] text-[15px] font-medium text-white transition-colors duration-150 hover:bg-[#4f5766] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8e9093] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPasskeyLoading ? "Signing in…" : "Sign in with a passkey"}
              </button>
            )}

            {passkeyError && (
              <p className="text-content text-red-400" role="alert">
                {passkeyError}
              </p>
            )}
          </form>
        </>
      )}

      <p className="mt-[26px] text-pretty text-center text-[12px] leading-[1.6] text-[#8e9093]">
        By continuing, you agree to Hypertask&rsquo;s{" "}
        <a
          href="https://hypertask.ai/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 transition-colors hover:text-white"
        >
          Terms&nbsp;of&nbsp;Service
        </a>{" "}
        and acknowledge our{" "}
        <a
          href="https://hypertask.ai/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 transition-colors hover:text-white"
        >
          Privacy&nbsp;Policy
        </a>.
      </p>
    </>
  );
};
