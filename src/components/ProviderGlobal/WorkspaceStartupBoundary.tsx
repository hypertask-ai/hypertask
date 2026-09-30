"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";
import { useRecoilValue } from "@/lib/state";
import { currentUserAtom } from "@/store";

const PUBLIC_ROUTE_PREFIXES = [
  "/login",
  "/invite",
  "/reset",
  "/pricing",
  "/oauth",
  "/cli-auth",
  "/share",
  "/demo",
  "/verify-email",
  "/add-to-slack",
  "/qa/login",
];

export default function WorkspaceStartupBoundary({
  children,
  authenticatedUserId,
  pathname,
}: {
  children: ReactNode;
  authenticatedUserId: number | null;
  pathname: string | null;
}) {
  const user = useRecoilValue(currentUserAtom);
  const [mounted, setMounted] = useState(false);
  useLayoutEffect(() => setMounted(true), []);

  const publicRoute = PUBLIC_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname?.startsWith(`${prefix}/`),
  );
  // Keep public SSR. Workspace effects must not run with default preferences
  // or an empty/stale profile; AuthProvider bootstraps outside this boundary.
  if (
    authenticatedUserId !== null &&
    !publicRoute &&
    (!mounted || user?.id !== authenticatedUserId)
  ) {
    return null;
  }

  return children;
}
