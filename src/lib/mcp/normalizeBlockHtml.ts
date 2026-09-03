import { normalizeRichTextStructure } from '../../utils/helperFunctions/normalizeRichTextStructure'

const BLOCK_TAG_PATTERN = /<\s*(?:p|div|ul|ol|li|h[1-6]|pre|blockquote|table|hr|figure|section|article)\b/i
const PARAGRAPH_BREAK_PATTERN = /(?:(?:<br\s*\/?>\s*){2,}|\n{2,})/i

export function normalizeBlockHtml(input: string): string {
  if (input.trim().length === 0) return input

  const blockHtml = BLOCK_TAG_PATTERN.test(input)
    ? input
    : input
        .replace(/\r\n?/g, '\n')
        .split(PARAGRAPH_BREAK_PATTERN)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
        .join('')

  return normalizeRichTextStructure(blockHtml)
}
