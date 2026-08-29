"use client";

import { useEffect, useRef } from "react";
import { useGetUserPreferences } from "./useGetUserPreferences";

export const useEmojiFrequencyHydration = (enabled = true) => {
  const { data: preferences, dataUpdatedAt } = useGetUserPreferences(
    undefined,
    undefined,
    { enabled },
  );
  const hydrated = useRef(false);

  useEffect(() => {
    if (hydrated.current) return;
    if (typeof window === "undefined") return;
    if (!dataUpdatedAt) return;

    // dataUpdatedAt is only truthy after a successful fetch (it stays 0 for the
    // initial placeholder and on error), so reaching here means the server map
    // for the CURRENT user is known. Server is the source of truth: overwrite
    // localStorage outright — with the server map, or {} when the user has no
    // history yet. This clears any map left by a previously signed-in account,
    // so a switched-in account never inherits or re-uploads the prior one.
    const serverMap = preferences?.emojiFrequency;
    const hasHistory =
      !!serverMap &&
      typeof serverMap === "object" &&
      !Array.isArray(serverMap) &&
      Object.keys(serverMap).length > 0;

    try {
      if (hasHistory) {
        window.localStorage.setItem(
          "emoji-mart.frequently",
          JSON.stringify(serverMap),
        );
      } else {
        // No saved history for this user: clear any map left by a previously
        // signed-in account and let emoji-mart fall back to its default set.
        window.localStorage.removeItem("emoji-mart.frequently");
        window.localStorage.removeItem("emoji-mart.last");
      }
      hydrated.current = true;
    } catch {}
  }, [dataUpdatedAt, preferences?.emojiFrequency]);
};
