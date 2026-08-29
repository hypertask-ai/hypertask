"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { buildHtmlBlockSrcDoc } from "./buildSrcDoc";

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
  const srcDoc = useMemo(() => buildHtmlBlockSrcDoc(html), [html]);

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
      // allow-scripts WITHOUT allow-same-origin: unique opaque origin, no
      // access to app cookies / ht_session / localStorage / parent DOM.
      sandbox="allow-scripts"
      title={title}
      scrolling="no"
      className={className}
      style={{ height, border: 0 }}
    />
  );
}
