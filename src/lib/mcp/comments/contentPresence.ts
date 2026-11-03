const MEDIA_TAG_PATTERN = /<\s*(?:img|video|audio|iframe|embed|object)\b/i
const TAG_PATTERN = /<[^>]*>/g
const INVISIBLE_ENTITY_PATTERN = /&(?:nbsp|ensp|emsp|thinsp|zwnj|zwj|shy|#0*32|#0*160|#0*8194|#0*8195|#0*8201|#0*8203|#0*8204|#0*8205|#x0*20|#x0*[aA]0|#x0*200[bBcCdD]);/g
const INVISIBLE_CHARACTER_PATTERN = /[\s\u00a0\u1680\u180e\u2000-\u200f\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]/g

export function hasVisibleContent(html: string): boolean {
  if (MEDIA_TAG_PATTERN.test(html)) return true
  return html.replace(TAG_PATTERN, '').replace(INVISIBLE_ENTITY_PATTERN, '').replace(INVISIBLE_CHARACTER_PATTERN, '').length > 0
}
