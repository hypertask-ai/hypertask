"use client";

import { useEffect } from "react";
import { useRecoilValue } from "@/lib/state";
import { currentUserAtom } from "@/store";
import { trackSignupCompleted } from "@/lib/analytics/fathom";

export default function FathomSignupCompleted({ accountId }: { accountId: number | null }) {
  const currentUser = useRecoilValue(currentUserAtom);

  useEffect(() => {
    try {
      return trackSignupCompleted(currentUser, accountId, window.localStorage, Date.now());
    } catch {
      return undefined;
    }
  }, [currentUser, accountId]);

  return null;
}
