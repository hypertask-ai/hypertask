import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { featureFlagsQueryKey, useFlag } from "@/hooks/useFlag";
import { HTPR_7008_PHONE_FIRST_LOAD_JS_FLAG } from "@/lib/flags/keys";

// Warms inbox modules split out by HTPR-7008, except on phones with the flag on.
export function useInboxLegacyWarm(queryClient: QueryClient, authenticatedUserId: number | null | undefined, pathname: string | null, mbl: boolean) {
  const phoneFirstLoadJs = useFlag(HTPR_7008_PHONE_FIRST_LOAD_JS_FLAG);
  const phoneJsFlagValue = queryClient.getQueryData<Record<string, boolean>>(
    featureFlagsQueryKey(authenticatedUserId ?? 0),
  )?.[HTPR_7008_PHONE_FIRST_LOAD_JS_FLAG];
  useEffect(() => {
    if (pathname !== "/inbox") return;
    // Wait for explicit Off: the query can resolve before useFlag hydrates.
    if (window.innerWidth < 768 && (phoneFirstLoadJs || phoneJsFlagValue !== false)) return;
    const legacyImports = Promise.all([
      import("@/lib/firstScreen/comment"),
      import("@/components/Modals/RemindMe/RemindMeComponent"),
    ]);
    void legacyImports.catch(() => {});
  }, [mbl, pathname, phoneFirstLoadJs, phoneJsFlagValue]);
}
