export function checklistFromBrief(html) {
  const text = html.replace(/<br\s*\/?\s*>|<\/(?:p|div|h[1-6]|li|section)>/gi, '\n').replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'");
  const lines = text.split('\n').map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  let start = lines.findIndex(x => /^change\s*[.:\-–]?\s*$/i.test(x));
  if (start === -1) start = lines.findIndex(x => /^change\b/i.test(x));
  let selected = lines;
  if (start !== -1) {
    const end = lines.findIndex((x, i) => i > start && /^(not in scope|done when)\b/i.test(x));
    selected = lines.slice(start, end === -1 ? undefined : end);
    selected[0] = selected[0].replace(/^change\b\s*[.:\-–]?\s*/i, '');
  }
  const sentences = selected.flatMap(line => line.match(/[^.!?]+(?:[.!?]+|$)/g) || []).map(s => s.trim()).filter(Boolean);
  return [...sentences, 'No purple anywhere.', 'No sparkle icon.', 'Every corner is 0, 2 or 4px.'].map((s, i) => `${i + 1}. [ ] ${s}`).join('\n');
}
export function isPurple(color) {
  let m = color.trim().toLowerCase().match(/^#([\da-f]{3,8})$/i), r, g, b, a = 1;
  if (m) {
    let h = m[1]; if (h.length === 3 || h.length === 4) h = [...h].map(x => x + x).join('');
    if (h.length !== 6 && h.length !== 8) return false;
    [r,g,b] = [0,2,4].map(i => parseInt(h.slice(i,i+2),16)); if (h.length === 8) a = parseInt(h.slice(6,8),16)/255;
  } else {
    m = color.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+)%?)?\s*\)$/i);
    if (!m) return false; [,r,g,b] = m.map(Number); if (m[4] !== undefined) a = Number(m[4]) / (/%\s*\)$/.test(color) ? 100 : 1);
  }
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max-min;
  if (!d || a <= 0.1) return false;
  const l = (max+min)/2, s = d/(1-Math.abs(2*l-1));
  const hue = ((max === r ? (g-b)/d : max === g ? (b-r)/d+2 : (r-g)/d+4)*60+360)%360;
  return hue >= 255 && hue <= 300 && s > 0.25;
}
export function radiusVerdict(px, py, w, h, roundAllowed = true) {
  if ([0,2,4].includes(px) && [0,2,4].includes(py)) return 'ok';
  return roundAllowed && w > 0 && h > 0 && Math.abs(w-h) <= 2 && Math.min(px,py) >= Math.min(w,h)/2 ? 'round' : 'bad';
}
export function isRoundMarker(names) {
  return names.split(/\s+/).some(name => /^(?:[\w-]*[-_])?(?:avatar|status-dot)(?:[-_][\w-]*)?$/i.test(name));
}
