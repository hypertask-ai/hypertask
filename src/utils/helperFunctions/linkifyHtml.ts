
const TOKEN_RE = /(<a\b[^>]*>)|(<\/a\s*>)|(<[^>]+>)|([^<]+)/gi;
const URL_RE = /https?:\/\/[^\s<>"']+/g;
const TRAILING_PUNCT_RE = /[.,;:!?)\]]+$/;

const wrap = (url: string): string => {
  const trailing = url.match(TRAILING_PUNCT_RE)?.[0] ?? "";
  const href = trailing ? url.slice(0, -trailing.length) : url;
  return `<a href="${href}" target="_blank" rel="noopener noreferrer">${href}</a>${trailing}`;
};

export function linkifyHtml(html: string): string {
  if (!html || !html.includes("http")) return html;

  let anchorDepth = 0;
  return html.replace(
    TOKEN_RE,
    (_m, aOpen?: string, aClose?: string, otherTag?: string, text?: string) => {
      if (aOpen) {
        anchorDepth++;
        return aOpen;
      }
      if (aClose) {
        anchorDepth = Math.max(0, anchorDepth - 1);
        return aClose;
      }
      if (otherTag) return otherTag;
      if (anchorDepth > 0) return text!;
      return text!.replace(URL_RE, wrap);
    }
  );
}
