"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { KeyRound, X } from "lucide-react";
import { useAuth } from "@/hooks/General/useAuth";
import { authClient } from "@/lib/auth/betterAuthClient";

type Pending = "google" | "passkey" | "email" | "code" | null;

/**
 * HTPR-4883: guests can't leave the board to /login (that drops the guest
 * session), so the CTA bar opens this in place. Auth methods mirror /login:
 * Google via useAuth().loginWithGoogle, passkey via authClient.signIn.passkey
 * + the legacy-session bridge, email via send-email-link -> verify-code.
 * Both server routes set the real cookies, so a hard navigation is all that's
 * needed to reboot the app as the new user (router.push races the cookies).
 */
export default function GuestLoginModal({ onClose }: { onClose: () => void }) {
  const { loginWithGoogle } = useAuth();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPasskeySupported, setIsPasskeySupported] = useState(false);

  useEffect(() => {
    setIsPasskeySupported(typeof window !== "undefined" && !!window.PublicKeyCredential);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handlePasskey = async () => {
    setError(null);
    setPending("passkey");
    try {
      const { error: passkeyError } = await authClient.signIn.passkey();
      if (passkeyError) {
        setError(passkeyError.message || "Passkey sign-in failed. Please try again.");
        return;
      }
      const bridge = await fetch("/api/auth/bridge-legacy-session", {
        method: "POST",
        credentials: "include",
      });
      if (!bridge.ok) {
        setError("Unable to complete sign-in. Please try again.");
        return;
      }
      window.location.assign("/");
    } catch (e: any) {
      setError(e?.message || "Passkey sign-in failed. Please try again.");
    } finally {
      setPending(null);
    }
  };

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Please enter a valid email address");
      return;
    }
    setError(null);
    setPending("email");
    try {
      const response = await fetch("/api/auth/send-email-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, utmData: {} }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to send sign-in code");
      }
      setStep("code");
    } catch (e: any) {
      setError(e?.message || "Failed to send sign-in code. Please try again.");
    } finally {
      setPending(null);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code) {
      setError("Verification code is required");
      return;
    }
    setError(null);
    setPending("code");
    try {
      const response = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          email,
          currentBrowserUrl: window.location.href,
          shouldSkipInteractive: false,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Code verification failed");
      }
      window.location.assign("/");
    } catch (e: any) {
      setError(e?.message || "Verification failed. Please try again.");
      setPending(null);
    }
  };

  const methodButton =
    "w-full flex items-center gap-3 rounded-[5px] bg-label-span hover:bg-hover-active px-4 py-2.5 text-content font-medium disabled:opacity-50 disabled:cursor-not-allowed";
  const inputClass =
    "w-full rounded-[5px] bg-label-span px-4 py-2.5 text-content outline-none placeholder:text-text-light-gray";

  return createPortal(
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-[400px] rounded-[8px] bg-modalBackground p-8 text-white-black shadow-customshadow-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 text-text-light-gray hover:text-white-black"
        >
          <X size={18} strokeWidth={1.75} />
        </button>

        {step === "email" ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="space-y-1">
              <h2 className="text-subheading font-semibold">Log in or sign up</h2>
              <p className="text-content text-text-light-gray">
                You&apos;ll keep this board and can invite your team, connect AI, and more.
              </p>
            </div>

            <button type="button" onClick={() => void loginWithGoogle()} className={methodButton}>
              <svg className="h-5 w-5 shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
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
              <span className="flex-1 text-center">Continue with Google</span>
            </button>

            {isPasskeySupported && (
              <button
                type="button"
                onClick={() => void handlePasskey()}
                disabled={pending === "passkey"}
                className={methodButton}
              >
                <KeyRound size={20} strokeWidth={1.75} className="shrink-0" />
                <span className="flex-1 text-center">
                  {pending === "passkey" ? "Signing in…" : "Continue with passkey"}
                </span>
              </button>
            )}

            <div className="flex w-full items-center gap-3 text-meta text-text-light-gray">
              <span className="h-px flex-1 bg-label-span" />
              OR
              <span className="h-px flex-1 bg-label-span" />
            </div>

            <form onSubmit={handleSendCode} className="w-full space-y-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                autoFocus
                className={inputClass}
              />
              <button
                type="submit"
                disabled={pending === "email"}
                className="btn btn-primary w-full rounded-[5px] py-2 text-content font-medium disabled:opacity-50"
              >
                {pending === "email" ? "Sending…" : "Continue"}
              </button>
            </form>

            {error && (
              <p className="text-meta text-red-400" role="alert">
                {error}
              </p>
            )}
          </div>
        ) : (
          <form onSubmit={handleVerifyCode} className="flex flex-col items-center gap-4 text-center">
            <div className="space-y-1">
              <h2 className="text-subheading font-semibold">Check your email</h2>
              <p className="text-content text-text-light-gray">We sent a code to {email}</p>
            </div>

            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6-digit code"
              inputMode="numeric"
              maxLength={6}
              autoFocus
              className={`${inputClass} text-center tracking-[4px]`}
            />

            <button
              type="submit"
              disabled={pending === "code"}
              className="btn btn-primary w-full rounded-[5px] py-2 text-content font-medium disabled:opacity-50"
            >
              {pending === "code" ? "Signing in…" : "Continue"}
            </button>

            {error && (
              <p className="text-meta text-red-400" role="alert">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
              }}
              className="text-meta text-text-light-gray hover:text-white-black"
            >
              Back
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}
