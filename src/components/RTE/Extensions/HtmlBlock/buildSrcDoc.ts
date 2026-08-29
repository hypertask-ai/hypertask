// Build the iframe srcdoc for an HTML block. Two safety layers wrap the agent's
// raw HTML:
//   1. The iframe is sandboxed with allow-scripts but NOT allow-same-origin, so
//      it runs on a unique opaque origin: no access to the app's cookies,
//      ht_session, localStorage, or parent DOM. Even hostile JS is trapped.
//   2. A Content-Security-Policy meta blocks network exfiltration (connect-src
//      'none'), remote/nested frames, external scripts, form posts, and base-uri
//      tricks. It is emitted FIRST so any CSP the agent adds can only tighten it.
// A tiny resize script postMessages the content height back to the parent (the
// only channel that survives the sandbox) so the block auto-sizes.

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

export function buildHtmlBlockSrcDoc(raw: string): string {
  let headExtra = "";
  let body = raw;

  // If the agent pasted a full HTML document, flatten it: move its <head> into
  // our controlled head (our CSP still wins, appearing first) and take its
  // <body> as the content, so nested <html>/<body> tags don't corrupt render.
  if (/<html[\s>]/i.test(raw) || /<!doctype/i.test(raw)) {
    try {
      const doc = new DOMParser().parseFromString(raw, "text/html");
      headExtra = doc.head ? doc.head.innerHTML : "";
      body = doc.body ? doc.body.innerHTML : raw;
    } catch {
      // fall back to treating raw as a body fragment
    }
  }

  return (
    "<!doctype html><html><head>" +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    "<style>html,body{margin:0;padding:0}body{overflow-x:hidden;word-break:break-word}</style>" +
    headExtra +
    "</head><body>" +
    body +
    RESIZE_SCRIPT +
    "</body></html>"
  );
}
