"use client";

import { Lock } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { isGuestCookieUser } from "@/lib/demo/isGuestClient";
import { showGuestLoginAtom } from "@/store";
import { useSetRecoilState } from "@/lib/state";

const GuestSignupOverlay = ({
  children,
  onSignup,
}: {
  children: ReactNode;
  /** Close the host modal; the login modal is global so it survives. */
  onSignup?: () => void;
}) => {
  const setShowGuestLogin = useSetRecoilState(showGuestLoginAtom);
  const [isGuest, setIsGuest] = useState(false);

  useEffect(() => setIsGuest(isGuestCookieUser()), []);

  return (
    // The host modals lay their header/body/footer out as a flex column, so the
    // wrapper has to be that column itself — as a plain block it clipped the
    // modal. No flex-1: the modal sizes to its content, growing here collapses it.
    <div className="relative flex min-h-0 flex-col">
      <div
        className={`flex min-h-0 flex-col ${isGuest ? "pointer-events-none select-none" : ""}`}
        inert={isGuest ? true : undefined}
      >
        {children}
      </div>
      {isGuest && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 rounded-[5px] bg-black/30 px-4 text-center backdrop-blur-sm">
          <Lock aria-hidden className="h-5 w-5 text-text-light-gray" strokeWidth={1.75} />
          <p className="text-content font-medium text-white-black">Available after signup</p>
          <button
            type="button"
            className="btn btn-primary btn-sm rounded-[5px]"
            onClick={() => {
              setShowGuestLogin(true);
              onSignup?.();
            }}
          >
            Create free account
          </button>
        </div>
      )}
    </div>
  );
};

export default GuestSignupOverlay;
