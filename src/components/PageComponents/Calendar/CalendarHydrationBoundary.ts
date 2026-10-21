"use client";

import { createElement, ReactNode, useEffect, useState } from "react";

export default function CalendarHydrationBoundary({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  return hasMounted ? children : fallback ?? createElement("div", null, "Loading...");
}
