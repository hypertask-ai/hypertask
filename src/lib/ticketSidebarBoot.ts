import { AI_CHAT_SIDEBAR_DEFAULT_PX, AI_CHAT_SIDEBAR_MIN_PX } from "@/lib/configs/style.config";

export const TICKET_SIDEBAR_BOOT_CSS = `
html .app-shell-rail {
  width: var(--app-shell-rail-w, 48px);
}
html[data-ticket-sidebar] [data-ai-chat-slot] {
  display: block !important;
  width: var(--ticket-sidebar-width) !important;
  position: static !important;
}
html[data-ticket-sidebar="closed"] [data-ai-chat-slot] {
  display: contents !important;
}
html[data-ticket-sidebar="overlay"] [data-ai-chat-slot] {
  position: fixed !important;
  top: 0;
  right: 0;
  z-index: 51;
}
`;

export function buildTicketSidebarBootScript({
  keepClosed,
  narrowWidth,
  overlayTicket,
}: {
  keepClosed: boolean;
  narrowWidth: boolean;
  overlayTicket: boolean;
}): string {
  return `(function(){try{
    if(!location.pathname.startsWith('/detail')||window.innerWidth<768)return;
    var s=JSON.parse(localStorage.getItem('recoil-persist')||'{}');
    if(!s||typeof s!=='object'||Array.isArray(s))return;
    var open=s.isAiChatSidebarMode!==false&&!(${keepClosed}&&s.keepAiChatClosed===true)&&
      (s.aiChatPinned===true||(s.openAiChatByDefault!==false&&s.aiChatAutoOpenSuppressed!==true));
    var width=typeof s.aiChatSidebarWidthPx==='number'&&Number.isFinite(s.aiChatSidebarWidthPx)
      ?Math.max(s.aiChatSidebarWidthPx,${AI_CHAT_SIDEBAR_MIN_PX}):${AI_CHAT_SIDEBAR_DEFAULT_PX};
    var overlay=${narrowWidth}&&window.innerWidth<Math.max(768,width+(${overlayTicket}?944:340));
    document.documentElement.style.setProperty('--ticket-sidebar-width',width+'px');
    document.documentElement.setAttribute('data-ticket-sidebar',!open?'closed':overlay?'overlay':'reserved');
  }catch(e){}})();`;
}
