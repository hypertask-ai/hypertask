"use client";

import { createElement, ReactNode, useEffect, useState } from "react";

export default function CalendarHydrationBoundary({
  children,
}: {
  children: ReactNode;
}) {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  return hasMounted ? children : createElement("div", null, "Loading...");
}
