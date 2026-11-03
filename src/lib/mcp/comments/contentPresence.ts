import { parse } from 'node-html-parser'

const MEDIA_SELECTOR = 'img, video, audio, iframe, embed, object'
const INVISIBLE_CHARACTER_PATTERN = /[\u200b-\u200f\u2060\ufeff]/g

export function hasVisibleContent(html: string): boolean {
  const root = parse(html)
  if (root.querySelector(MEDIA_SELECTOR) !== null) return true
  return root.structuredText.replace(INVISIBLE_CHARACTER_PATTERN, '').trim().length > 0
}
