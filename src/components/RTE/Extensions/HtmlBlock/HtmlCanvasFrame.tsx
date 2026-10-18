"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { useFlag } from "@/hooks/useFlag";
import { HTPR_6872_PAGE_IMAGE_GALLERY_FLAG, HTPR_7321_CANVAS_LINKS_FLAG } from "@/lib/flags/keys";
import { buildHtmlBlockSrcDoc } from "./buildSrcDoc";

const MIN_HEIGHT = 120;
const SANDBOX = "allow-scripts";
const SANDBOX_WITH_NEW_TAB_LINKS = "allow-scripts allow-popups allow-popups-to-escape-sandbox";

export function HtmlCanvasFrame({
  html,
  className,
  title = "Embedded HTML",
}: {
  html: string;
  className?: string;
  title?: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(MIN_HEIGHT);
  const pathname = usePathname();
  const linksOpenInNewTab = useFlag(HTPR_7321_CANVAS_LINKS_FLAG);
  const galleryEnabled = useFlag(HTPR_6872_PAGE_IMAGE_GALLERY_FLAG);
  const pageGalleryEnabled = galleryEnabled && Boolean(pathname?.startsWith("/page/"));
  const srcDoc = useMemo(
    () => buildHtmlBlockSrcDoc(html, pageGalleryEnabled, linksOpenInNewTab),
    [html, pageGalleryEnabled, linksOpenInNewTab],
  );

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const frame = iframeRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const data = event.data as { __htHtmlBlock?: unknown; h?: unknown };
      if (data?.__htHtmlBlock && typeof data.h === "number") {
        setHeight(Math.max(MIN_HEIGHT, Math.ceil(data.h)));
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      sandbox={linksOpenInNewTab ? SANDBOX_WITH_NEW_TAB_LINKS : SANDBOX}
      title={title}
      scrolling="no"
      className={className}
      style={{ height, border: 0 }}
    />
  );
}
