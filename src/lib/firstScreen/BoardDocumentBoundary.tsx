"use client";

import { Suspense, useState, type ReactNode } from "react";
import { useHydrated } from "@/hooks/General/useHydrated";
import { useFirstScreenSurface } from "./SurfaceContext";

export default function BoardDocumentBoundary({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const hydrated = useHydrated();
  const snapshot = useFirstScreenSurface();
  // Keep critical document content out of hidden streaming segments. Latch the
  // boundary shape through hydration; later client-mounted controls may suspend.
  const [document] = useState(() => !hydrated && snapshot?.scope.route === "/project");
  return document ? <>{children}</> : <Suspense fallback={fallback}>{children}</Suspense>;
}
