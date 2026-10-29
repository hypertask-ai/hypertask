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
  overlayTicket,
  autoOpenSwitches = false,
  manualChat = false,
  userId = null,
}: {
  keepClosed: boolean;
  overlayTicket: boolean;
  autoOpenSwitches?: boolean;
  manualChat?: boolean;
  userId?: number | null;
}): string {
  return `(function(){try{
    if(!location.pathname.startsWith('/detail')||window.innerWidth<768)return;
    var s=JSON.parse(localStorage.getItem('recoil-persist')||'{}');
    if(!s||typeof s!=='object'||Array.isArray(s))return;
    var open=s.isAiChatSidebarMode!==false&&!(${keepClosed}&&s.keepAiChatClosed===true)&&
      (s.aiChatPinned===true||(s.openAiChatByDefault!==false&&s.aiChatAutoOpenSuppressed!==true));
    if(${manualChat}){
      try{open=s.isAiChatSidebarMode!==false&&sessionStorage.getItem('ht:aiChatOpen')==='1';}catch(e){open=false;}
    } else if(${autoOpenSwitches}){
      var prefs=(s.aiChatAutoOpenPreferences||{})[${userId}];
      var enabled=prefs&&typeof prefs.aiChatOpenTickets==='boolean'?prefs.aiChatOpenTickets:
        s.keepAiChatClosed!==true&&Object.prototype.hasOwnProperty.call(s,'openAiChatByDefault')&&s.openAiChatByDefault===true;
      var samePage=s.aiChatAutoOpenPage==null||s.aiChatAutoOpenPage===String(${userId})+':'+location.pathname+':'+(new URLSearchParams(location.search).get('id')||'')+':'+(new URLSearchParams(location.search).get('view')||'');
      open=s.isAiChatSidebarMode!==false&&enabled&&!(samePage&&s.aiChatAutoOpenSuppressed===true);
    }
    var width=typeof s.aiChatSidebarWidthPx==='number'&&Number.isFinite(s.aiChatSidebarWidthPx)
      ?Math.max(s.aiChatSidebarWidthPx,${AI_CHAT_SIDEBAR_MIN_PX}):${AI_CHAT_SIDEBAR_DEFAULT_PX};
    var overlay=window.innerWidth<Math.max(768,width+(${overlayTicket}?944:340));
    document.documentElement.style.setProperty('--ticket-sidebar-width',width+'px');
    document.documentElement.setAttribute('data-ticket-sidebar',!open?'closed':overlay?'overlay':'reserved');
  }catch(e){}})();`;
}
