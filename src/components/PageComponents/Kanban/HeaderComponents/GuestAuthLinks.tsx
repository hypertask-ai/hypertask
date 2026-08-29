"use client";

import { useEffect, useState } from "react";
import { useSetRecoilState } from "@/lib/state";
import { showGuestLoginAtom } from "@/store";
import { isGuestCookieUser } from "@/lib/demo/isGuestClient";

// HTPR-4890: the same guest CTAs as the rail's bottom cluster, duplicated into
// the board header row. Guest-gated here so callers can drop it in unguarded.
// ponytail: `floating` pins it to the viewport's top-right for the surfaces with
// no header row to join (see GloablProviders) — fixed, so it can never change a
// row's height or push content down. Beats threading it through ~11 bespoke
// per-surface title rows; give it a real slot if one of those grows one.
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
          ? // 32px, not 16: with the chat closed this row shares the top-right
            // corner with the chat's reopen chevron (right-1, 16px wide).
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
      {/* ponytail: explicit bg token, not `btn btn-primary` — those flatten to
          plain text in this row (live screenshot), so don't rely on Bootstrap here.
          White (theme-inverse) CTA, not purple (Valentin, 2026-08-04). */}
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
