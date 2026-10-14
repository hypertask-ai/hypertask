"use client";

import { useEffect } from "react";
import { toFilesFallbackUrl } from "@/lib/files/fallbackUrl";

export default function FilesImageFallback() {
  useEffect(() => {
    const onError = (event: Event) => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement) || image.hasAttribute("data-files-fallback")) {
        return;
      }
      const fallback = toFilesFallbackUrl(image.currentSrc || image.src);
      if (!fallback) return;

      image.setAttribute("data-files-fallback", "1");
      if (image.srcset.split(",").some((candidate) =>
        toFilesFallbackUrl(candidate.trim().split(/\s+/)[0]),
      )) {
        image.srcset = "";
      }
      image.src = fallback;
    };

    document.addEventListener("error", onError, true);
    return () => document.removeEventListener("error", onError, true);
  }, []);

  return null;
}
