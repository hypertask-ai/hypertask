"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { useFlag } from "@/hooks/useFlag";
import { HTPR_6872_PAGE_IMAGE_GALLERY_FLAG, HTPR_7321_CANVAS_LINKS_FLAG } from "@/lib/flags/keys";
import { buildHtmlBlockSrcDoc } from "./buildSrcDoc";
import { LINK_READY_MESSAGE, openLinksClickedIn } from "./canvasLinks";

const MIN_HEIGHT = 120;

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
    let linkPort: MessagePort | null = null;
    const handleMessage = (event: MessageEvent) => {
      const frame = iframeRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const data = event.data as { __htHtmlBlock?: unknown; h?: unknown; [LINK_READY_MESSAGE]?: unknown };
      if (linksOpenInNewTab && !linkPort && data?.[LINK_READY_MESSAGE] === 1) {
        linkPort = openLinksClickedIn(frame);
        return;
      }
      if (data?.__htHtmlBlock && typeof data.h === "number") {
        setHeight(Math.max(MIN_HEIGHT, Math.ceil(data.h)));
      }
    };
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      linkPort?.close();
    };
  }, [srcDoc, linksOpenInNewTab]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      title={title}
      scrolling="no"
      className={className}
      style={{ height, border: 0 }}
    />
  );
}
