"use client";

import { X } from "lucide-react";
import { useContext, useEffect, useState } from "react";

import { isGuestCookieUser } from "@/lib/demo/isGuestClient";
import { getCookieConsent, setCookieConsent } from "@/lib/cookieConsent";
import { cn } from "@/utils/undoActions/helperFuncs";
import { MobileViewContext } from "@/lib/contexts/mobileContext";

// HTPR-4883: mirrors ChatGPT's anonymous-session cookie banner. Guests only —
// signed-in users have already agreed to Terms/Privacy at signup.
const CookieConsentBanner = () => {
  const [shouldRender, setShouldRender] = useState(false);
  // Taller targets on a phone only: this is the first thing a mobile visitor
  // touches and its close X measured 16x16 (HTPR-5142). Desktop is unchanged.
  const _mbl = useContext(MobileViewContext);

  useEffect(() => {
    setShouldRender(isGuestCookieUser() && getCookieConsent() === null);
  }, []);

  const choose = (value: "all" | "essential") => {
    setCookieConsent(value);
    setShouldRender(false);
  };

  if (!shouldRender) return null;

  return (
    <div
      role="region"
      aria-label="Cookie consent"
      className="fixed left-1/2 z-[200] w-[calc(100%-24px)] max-w-[600px] -translate-x-1/2 rounded-[5px] bg-modalBackground p-4 text-white-black shadow-customshadow-2"
      style={{
        // 72px clears the bottom bar, which is ~47px tall for guests once its
        // CTA buttons replace the keyboard tips (HTPR-4883).
        bottom: "calc(var(--mobile-dock-h, 0px) + 72px + env(safe-area-inset-bottom))",
      }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <h2 className="text-content font-semibold text-white-black">
          We use cookies
        </h2>
        <button
          type="button"
          onClick={() => choose("essential")}
          aria-label="Reject optional cookies"
          className={cn("flex shrink-0 items-center justify-center text-text-light-gray hover:text-white-black", _mbl && "h-11 w-11")}
        >
          <X size={16} strokeWidth={1.75} />
        </button>
      </div>

      <p className="text-content text-text-light-gray">
        Cookies help this site work and measure usage.
      </p>
      <p className="mt-1 text-content text-text-light-gray">
        By using Hypertask you agree to our{" "}
        <a
          href="https://hypertask.ai/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="text-white-black underline underline-offset-2"
        >
          Terms
        </a>{" "}
        and{" "}
        <a
          href="https://hypertask.ai/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="text-white-black underline underline-offset-2"
        >
          Privacy Policy
        </a>
        .
      </p>

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => choose("essential")}
          className={cn("px-3 text-content font-medium text-text-light-gray hover:text-white-black", _mbl ? "min-h-[44px]" : "py-1.5")}
        >
          Reject optional
        </button>
        <button
          type="button"
          onClick={() => choose("all")}
          className={cn("btn btn-primary btn-sm rounded-[5px] px-3 text-content font-medium", _mbl && "min-h-[44px]")}
        >
          Accept all
        </button>
      </div>
    </div>
  );
};

export default CookieConsentBanner;
