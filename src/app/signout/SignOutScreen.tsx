"use client";

import { useEffect, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { useSignout } from "@/hooks/MultiPages/HTC/useSignout";
import { authClient } from "@/lib/auth/betterAuthClient";
import authConfig from "@/lib/configs/auth.config";

type Status = "signing-out" | "signed-out" | "failed";

const buttonClassName =
  "mt-6 inline-flex min-h-10 items-center justify-center rounded-[4px] bg-hypertasks-purple px-4 py-2 text-content font-medium text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selected-item-border disabled:opacity-60";

export default function SignOutScreen() {
  const { handleHardReset } = useSignout(undefined, { redirectTo: null });
  const [status, setStatus] = useState<Status>("signing-out");
  const [starting, setStarting] = useState(false);
  const started = useRef(false);

  const signOut = () => {
    setStatus("signing-out");
    void handleHardReset().then((done) => setStatus(done ? "signed-out" : "failed"));
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    signOut();
  }, []);

  const signInAgain = async () => {
    setStarting(true);
    const { data } = await authClient.signIn.social({
      provider: "google",
      callbackURL: authConfig.redirect.afterLogin,
      errorCallbackURL: "/login?authError=google_signup_disabled",
      disableRedirect: true,
    });
    if (!data?.url) {
      window.location.assign("/login");
      return;
    }
    const url = new URL(data.url);
    url.searchParams.set("prompt", "select_account");
    window.location.assign(url.toString());
  };

  return (
    <main className="flex min-h-SVH-full w-full items-center justify-center bg-pageBackground px-6 text-white-black">
      <section
        aria-live="polite"
        className="flex w-full max-w-[560px] flex-col items-center rounded-[4px] bg-cardBackground px-6 py-8 text-center shadow-md sm:px-10"
      >
        <LogOut aria-hidden="true" className="h-16 w-16 text-text-light-gray" strokeWidth={1.75} />
        {status === "signing-out" && (
          <h1 className="mt-5 text-heading font-semibold">Signing you out</h1>
        )}
        {status === "signed-out" && (
          <>
            <h1 className="mt-5 text-heading font-semibold">You are signed out</h1>
            <p className="mt-2 max-w-[420px] text-content text-text-light-gray">
              This browser no longer holds a Hypertask session. Pick your account when you sign in again.
            </p>
            <button type="button" onClick={signInAgain} disabled={starting} className={buttonClassName}>
              Sign in again
            </button>
          </>
        )}
        {status === "failed" && (
          <>
            <h1 className="mt-5 text-heading font-semibold">Could not sign you out</h1>
            <p className="mt-2 max-w-[420px] text-content text-text-light-gray">
              Nothing was changed. Try again.
            </p>
            <button type="button" onClick={signOut} className={buttonClassName}>
              Try again
            </button>
          </>
        )}
      </section>
    </main>
  );
}
