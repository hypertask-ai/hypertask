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
        window.localStorage.removeItem("emoji-mart.frequently");
        window.localStorage.removeItem("emoji-mart.last");
      }
      hydrated.current = true;
    } catch {}
  }, [dataUpdatedAt, preferences?.emojiFrequency]);
};
