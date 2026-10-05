"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { hasFirstScreenDisplayPreferences, type FirstScreenInitialModel, type FirstScreenWireValue } from "./contract";

export type FirstScreenSnapshot = FirstScreenInitialModel<FirstScreenWireValue>;
const SurfaceContext = createContext<FirstScreenSnapshot | null>(null);

// Steps 3/4 supply this above the existing global owners, not in a state island.
export function FirstScreenSurfaceProvider({ snapshot, children }: {
  snapshot: FirstScreenSnapshot;
  children: ReactNode;
}) {
  const [now, setNow] = useState(snapshot.now);
  useEffect(() => {
    // Keep hydration exact; subsequent real time changes are live, not a replay.
    const timer = setInterval(() => setNow(new Date().toISOString()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return <SurfaceContext.Provider value={now === snapshot.now ? snapshot : { ...snapshot, now }}>{children}</SurfaceContext.Provider>;
}

export function useFirstScreenSurface(accountId?: number | null) {
  const snapshot = useContext(SurfaceContext);
  const pathname = usePathname();
  return snapshot && snapshot.schemaVersion === 1 &&
    (pathname === "/project" || pathname === "/inbox") &&
    pathname === snapshot.scope.route &&
    (accountId === undefined || accountId === snapshot.scope.accountId) &&
    snapshot.authorization.outcome === "authorized" &&
    snapshot.flags.accountId === snapshot.scope.accountId &&
    snapshot.flags.values["htpr-6934-server-first-screen"] === true &&
    hasFirstScreenDisplayPreferences(snapshot.display, snapshot.scope.accountId)
    ? snapshot : null;
}
