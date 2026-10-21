"use client";

import { Suspense, useState, type ReactNode } from "react";
import { useHydrated } from "@/hooks/General/useHydrated";
import { useFirstScreenSurface } from "./SurfaceContext";

export default function BoardDocumentBoundary({ children, fallback, route = "/project" }: { children: ReactNode; fallback: ReactNode; route?: "/project" | "/inbox" }) {
  const hydrated = useHydrated();
  const snapshot = useFirstScreenSurface();
  const [document] = useState(() => !hydrated && snapshot?.scope.route === route);
  return document ? <>{children}</> : <Suspense fallback={fallback}>{children}</Suspense>;
}
