"use client";

import { usePathname } from "next/navigation";
import { useRecoilValue } from "@/lib/state";
import { currentUserAtom } from "@/store";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7553_EMAIL_STRAIGHT_BOARD_FLAG } from "@/lib/flags/definitions/htpr-7553-email-straight-board";
import { isGuestUser } from "@/lib/demo/guest";
import { useResendVerificationEmail } from "@/hooks/useResendVerificationEmail";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

const EXCLUDED_PREFIXES = [
  "/login",
  "/onboarding",
  "/verify-email",
  "/invite",
  "/share",
  "/unauthorized",
];

export default function EmailConfirmBanner() {
  const pathname = usePathname();
  const currentUser = useRecoilValue(currentUserAtom);
  const flagOn = useFlag(HTPR_7553_EMAIL_STRAIGHT_BOARD_FLAG);
  const [dismissed, setDismissed] = useState(false);
  const { isResending, handleResend } = useResendVerificationEmail();

  useEffect(() => {
    setDismissed(false);
  }, [currentUser?.id]);

  if (!flagOn || !currentUser || isGuestUser(currentUser)) return null;
  const verified = currentUser.UserSetting?.isVerified ?? true;
  if (verified || dismissed) return null;
  if (EXCLUDED_PREFIXES.some((p) => pathname === p || pathname?.startsWith(p))) {
    return null;
  }

  const email = currentUser.email ?? "";

  return (
    <div
      className="w-full bg-blue-600/20 border-b border-blue-500/40 px-4 py-3 flex items-center justify-center gap-3 text-content text-white-black z-[120]"
      role="status"
    >
      <span className="text-center">
        Please confirm your email
        {email ? ` (${email})` : ""}.
      </span>
      <button
        type="button"
        className="underline text-blue-300 hover:text-blue-200 disabled:opacity-50"
        disabled={isResending || !email}
        onClick={() => handleResend(email)}
      >
        {isResending ? "Sending…" : "Resend"}
      </button>
      <button
        type="button"
        className="ml-2 p-1 hover:bg-white/10 rounded"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
