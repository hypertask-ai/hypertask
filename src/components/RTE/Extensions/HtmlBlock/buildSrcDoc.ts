import { LINK_PORT_MESSAGE, LINK_READY_MESSAGE } from "./canvasLinks";

const CSP = [
  "default-src 'none'",
  "img-src data: https: http:",
  "media-src https: data:",
  "style-src 'unsafe-inline' https:",
  "font-src https: data:",
  "script-src 'unsafe-inline'",
  "connect-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const RESIZE_SCRIPT =
  "<scr" +
  "ipt>(function(){function h(){try{var d=document;parent.postMessage({__htHtmlBlock:1,h:Math.max(d.documentElement.scrollHeight,d.body?d.body.scrollHeight:0)},'*');}catch(e){}}window.addEventListener('load',h);window.addEventListener('resize',h);if(window.ResizeObserver){try{new ResizeObserver(h).observe(document.documentElement);if(document.body)new ResizeObserver(h).observe(document.body);}catch(e){}}var n=0,t=setInterval(function(){h();if(++n>25)clearInterval(t);},150);})();</scr" +
  "ipt>";

const IMAGE_CLICK_SCRIPT = `<script>
document.addEventListener('click', function(event) {
  if (event.defaultPrevented || event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
  var image = event.target.closest('img');
  var images = Array.from(document.querySelectorAll('img')).filter(function(img) { return !img.closest('[data-figma-embed-preview]'); });
  var index = images.indexOf(image);
  if (index < 0) return;
  event.preventDefault();
  parent.postMessage({__htPageImage:1, images:images.map(function(img) { return img.src; }), index:index}, '*');
});
</script>`;

const LINK_CLICK_SCRIPT = `<script>
(function() {
  var apply = Reflect.apply;
  var send = MessagePort.prototype.postMessage;
  var closest = Element.prototype.closest;
  var getAttribute = Element.prototype.getAttribute;
  var preventDefault = Event.prototype.preventDefault;
  var stopImmediatePropagation = Event.prototype.stopImmediatePropagation;
  var getter = function(proto, name) { return Object.getOwnPropertyDescriptor(proto, name).get; };
  var hrefOf = getter(HTMLAnchorElement.prototype, 'href');
  var protocolOf = getter(HTMLAnchorElement.prototype, 'protocol');
  var dataOf = getter(MessageEvent.prototype, 'data');
  var portsOf = getter(MessageEvent.prototype, 'ports');
  var sourceOf = getter(MessageEvent.prototype, 'source');
  var parentWindow = window.parent;
  var port = null;
  window.addEventListener('message', function(event) {
    if (port || apply(sourceOf, event, []) !== parentWindow) return;
    var data = apply(dataOf, event, []);
    var ports = apply(portsOf, event, []);
    if (!data || data.${LINK_PORT_MESSAGE} !== 1 || !ports[0]) return;
    apply(stopImmediatePropagation, event, []);
    port = ports[0];
  }, true);
  parentWindow.postMessage({ ${LINK_READY_MESSAGE}: 1 }, '*');
  window.addEventListener('click', function(event) {
    if (!event.isTrusted || event.defaultPrevented || !(event.target instanceof Element)) return;
    var a = apply(closest, event.target, ['a[href]']);
    if (!a) return;
    var raw = apply(getAttribute, a, ['href']) || '';
    if (raw.charAt(0) === '#') {
      apply(preventDefault, event, []);
      var fragment = raw.slice(1);
      try { fragment = decodeURIComponent(fragment); } catch (e) {}
      var target = document.getElementById(fragment) || document.getElementsByName(fragment)[0];
      if (target) target.scrollIntoView();
      return;
    }
    var protocol = apply(protocolOf, a, []);
    if (protocol !== 'http:' && protocol !== 'https:') return;
    apply(preventDefault, event, []);
    if (port) apply(send, port, [{ href: apply(hrefOf, a, []) }]);
  });
})();
</script>`;

export function buildHtmlBlockSrcDoc(raw: string, imageGalleryEnabled = false, linksOpenInNewTab = false): string {
  let headExtra = "";
  let body = raw;

  if (/<html[\s>]/i.test(raw) || /<!doctype/i.test(raw)) {
    try {
      const doc = new DOMParser().parseFromString(raw, "text/html");
      headExtra = doc.head ? doc.head.innerHTML : "";
      body = doc.body ? doc.body.innerHTML : raw;
    } catch {
    }
  }

  return (
    "<!doctype html><html><head>" +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    "<style>html,body{margin:0;padding:0}body{overflow-x:hidden;word-break:break-word}</style>" +
    (linksOpenInNewTab ? LINK_CLICK_SCRIPT : "") +
    headExtra +
    "</head><body>" +
    body +
    RESIZE_SCRIPT +
    (imageGalleryEnabled ? IMAGE_CLICK_SCRIPT : "") +
    "</body></html>"
  );
}
