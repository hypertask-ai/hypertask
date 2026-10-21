export const LINK_PORT_MESSAGE = "__htHtmlBlockLinkPort";
export const LINK_READY_MESSAGE = "__htHtmlBlockLinkReady";

function webUrl(href: unknown): string | null {
  if (typeof href !== "string") return null;
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function openLinksClickedIn(frame: HTMLIFrameElement): MessagePort {
  const channel = new MessageChannel();
  channel.port1.onmessage = (event: MessageEvent<{ href?: unknown }>) => {
    const url = webUrl(event.data?.href);
    const userJustClickedThisCanvas =
      window.navigator.userActivation?.isActive === true && document.activeElement === frame;
    if (url && userJustClickedThisCanvas) window.open(url, "_blank", "noopener,noreferrer");
  };
  frame.contentWindow?.postMessage({ [LINK_PORT_MESSAGE]: 1 }, "*", [channel.port2]);
  return channel.port1;
}
