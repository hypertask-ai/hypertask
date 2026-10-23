import { useEffect } from "react";

export function useInboxLegacyWarm(pathname: string | null, mbl: boolean) {
  useEffect(() => {
    if (pathname !== "/inbox") return;
    if (window.innerWidth < 768) return;
    const legacyImports = Promise.all([
      import("@/lib/firstScreen/comment"),
      import("@/components/Modals/RemindMe/RemindMeComponent"),
    ]);
    void legacyImports.catch(() => {});
  }, [mbl, pathname]);
}
