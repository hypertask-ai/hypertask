// HTPR-7130: the server first screen paints board cards as plain <a href>
// links before React has hydrated them. A phone tap in that window follows the
// link natively and reloads the whole page. This early script holds such a
// tap (only on a card link React has not hydrated yet, and only when nothing
// else handled the click) and PendingTaskTapReplay opens it in place once the
// app has started.

export const PENDING_TASK_TAP_EVENT = "ht-pending-task-tap";
const PENDING_TASK_TAP_KEY = "__htPendingTaskTap";

type PendingTaskTapWindow = { [PENDING_TASK_TAP_KEY]?: string | null };

// If the app never starts (or takes this long), open the held card the old way.
export const PENDING_TASK_TAP_FALLBACK_MS = 4000;

export function buildPendingTaskTapScript(fallbackMs = PENDING_TASK_TAP_FALLBACK_MS): string {
  // Window capture runs before React's root listener. When React cannot
  // hydrate the card synchronously it stops the click's propagation but leaves
  // the link's default action, which is the full reload. So the hold starts in
  // capture; if the click still reaches window bubble on a card React has now
  // hydrated, React's own handler opened it and the hold is dropped.
  // A later tap replaces the held one and its fallback timer; replay and the
  // bubble check clear the held href, so the fallback never navigates twice.
  return `(function(){var held=null,fallback=null;function card(e){if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return null;var t=e.target,a=t&&t.closest?t.closest('a[href^="/detail/"]'):null;if(!a||!a.closest('[id^="task-"]')||(a.target&&a.target!=='_self'))return null;return a}function hydrated(a){var k=Object.keys(a);for(var i=0;i<k.length;i++){if(k[i].indexOf('__reactProps')===0)return true}return false}window.addEventListener('click',function(e){try{var a=card(e);if(!a||hydrated(a))return;e.preventDefault();held=e;var href=a.getAttribute('href');window.${PENDING_TASK_TAP_KEY}=href;if(fallback)clearTimeout(fallback);fallback=setTimeout(function(){fallback=null;if(window.${PENDING_TASK_TAP_KEY}===href){window.${PENDING_TASK_TAP_KEY}=null;window.location.assign(href)}},${Number(fallbackMs)});setTimeout(function(){if(window.${PENDING_TASK_TAP_KEY})window.dispatchEvent(new Event('${PENDING_TASK_TAP_EVENT}'))},0)}catch(x){}},true);window.addEventListener('click',function(e){try{if(e!==held)return;held=null;var t=e.target,a=t&&t.closest?t.closest('a[href^="/detail/"]'):null;if(a&&hydrated(a))window.${PENDING_TASK_TAP_KEY}=null}catch(x){}});})();`;
}

export function consumePendingTaskTap(win: Window): string | null {
  const holder = win as unknown as PendingTaskTapWindow;
  const href = holder[PENDING_TASK_TAP_KEY];
  holder[PENDING_TASK_TAP_KEY] = null;
  return typeof href === "string" && href.startsWith("/detail/") ? href : null;
}
