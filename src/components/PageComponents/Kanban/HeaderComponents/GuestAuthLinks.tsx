"use client";

import { useEffect, useState } from "react";
import { useSetRecoilState } from "@/lib/state";
import { showGuestLoginAtom } from "@/store";
import { isGuestCookieUser } from "@/lib/demo/isGuestClient";

const GuestAuthLinks = ({ floating = false }: { floating?: boolean }) => {
  const setShowLogin = useSetRecoilState(showGuestLoginAtom);
  const [isGuest, setIsGuest] = useState(false);

  useEffect(() => setIsGuest(isGuestCookieUser()), []);

  if (!isGuest) return null;

  return (
    <div
      className={`flex shrink-0 items-center gap-2 whitespace-nowrap ${
        floating ? "fixed top-3 z-[70]" : ""
      }`}
      style={
        floating
          ?
            { right: "calc(var(--ht-ai-sidebar-width, 0px) + 32px)" }
          : undefined
      }
    >
      <button
        type="button"
        onClick={() => setShowLogin(true)}
        className="rounded-[5px] border border-light-black-border-1 px-3 py-1 text-content font-medium text-white-black hover:bg-hover-active"
      >
        Log in
      </button>
      <button
        type="button"
        onClick={() => setShowLogin(true)}
        className="rounded-[5px] bg-white-black px-3 py-1 text-content font-medium text-white-black-inverted hover:opacity-90"
      >
        Sign up for free
      </button>
      <a
        href="https://hypertask.ai/pricing"
        target="_blank"
        rel="noopener noreferrer"
        className="text-content font-medium text-text-light-gray hover:text-white-black"
      >
        Pricing
      </a>
    </div>
  );
};

export default GuestAuthLinks;
