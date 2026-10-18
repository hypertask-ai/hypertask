"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useFlag } from "@/hooks/useFlag";
import { HTPR_6872_PAGE_IMAGE_GALLERY_FLAG, HTPR_7321_CANVAS_LINKS_FLAG } from "@/lib/flags/keys";
import { buildHtmlBlockSrcDoc } from "./buildSrcDoc";
import { resolveCanvasLink } from "./canvasLink";

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
  const router = useRouter();
  const linkHandoffEnabled = useFlag(HTPR_7321_CANVAS_LINKS_FLAG);
  const galleryEnabled = useFlag(HTPR_6872_PAGE_IMAGE_GALLERY_FLAG);
  const pageGalleryEnabled = galleryEnabled && Boolean(pathname?.startsWith("/page/"));
  const srcDoc = useMemo(
    () => buildHtmlBlockSrcDoc(html, pageGalleryEnabled, linkHandoffEnabled),
    [html, pageGalleryEnabled, linkHandoffEnabled],
  );

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const frame = iframeRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const data = event.data as { __htHtmlBlock?: unknown; h?: unknown; __htHtmlBlockLink?: unknown; href?: unknown; newTab?: unknown };
      if (linkHandoffEnabled && data?.__htHtmlBlockLink === 1) {
        const link = resolveCanvasLink(data.href, window.location.origin);
        if (!link) return;
        if (link.kind === "internal" && data.newTab !== true) {
          router.push(link.path);
        } else {
          const url = link.kind === "external" ? link.url : new URL(link.path, window.location.origin).href;
          window.open(url, "_blank", "noopener,noreferrer");
        }
        return;
      }
      if (data?.__htHtmlBlock && typeof data.h === "number") {
        setHeight(Math.max(MIN_HEIGHT, Math.ceil(data.h)));
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [linkHandoffEnabled, router]);

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
