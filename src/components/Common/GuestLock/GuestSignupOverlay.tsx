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
  onSignup?: () => void;
}) => {
  const setShowGuestLogin = useSetRecoilState(showGuestLoginAtom);
  const [isGuest, setIsGuest] = useState(false);

  useEffect(() => setIsGuest(isGuestCookieUser()), []);

  return (
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
