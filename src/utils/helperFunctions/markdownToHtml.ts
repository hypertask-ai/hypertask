import { Marked } from 'marked'
import { normalizeBlockHtml } from '../../lib/mcp/normalizeBlockHtml'
import { escapeHtml } from './escapeHtml'
import { sanitizeRichHtml } from './sanitizeRichHtml'

export function renderMarkdownImage({ href, text }: { href?: string; text?: string }): string {
  const label = escapeHtml(text || href || '')
  if (!href) return label
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
}

const marked = new Marked({ gfm: true, async: false })
marked.use({
  renderer: {
    image: renderMarkdownImage,
    html: ({ raw }) => escapeHtml(raw),
  },
})

const STRUCTURAL_MARKDOWN_TOKEN_TYPES = new Set([
  'blockquote',
  'br',
  'codespan',
  'del',
  'em',
  'heading',
  'hr',
  'image',
  'list',
  'strong',
  'table',
])

type MarkdownTokenLike = {
  type?: string
  raw?: string
  tokens?: unknown
  items?: unknown
}

function isStructuralMarkdownToken(token: MarkdownTokenLike): boolean {
  if (token.type && STRUCTURAL_MARKDOWN_TOKEN_TYPES.has(token.type)) return true
  if (token.type === 'code') return /^\s*(?:```|~~~)/.test(token.raw || '')
  if (token.type === 'link') return /^\s*(?:\[|<)/.test(token.raw || '')
  return false
}

function inspectMarkdownTokens(
  value: unknown,
  state: { hasHtml: boolean; hasStructure: boolean }
): void {
  if (Array.isArray(value)) {
    for (const item of value) inspectMarkdownTokens(item, state)
    return
  }
  if (!value || typeof value !== 'object') return

  const token = value as MarkdownTokenLike
  if (token.type === 'html') state.hasHtml = true
  if (isStructuralMarkdownToken(token)) state.hasStructure = true
  inspectMarkdownTokens(token.tokens, state)
  inspectMarkdownTokens(token.items, state)
}

export function hasMarkdownStructure(value: string): boolean {
  if (value.trim().length === 0) return false
  const state = { hasHtml: false, hasStructure: false }
  inspectMarkdownTokens(marked.lexer(value), state)
  return state.hasStructure && !state.hasHtml
}

const QUOTED_LINE = /^[ \t]{0,3}>[ \t]?(.*)$/
const CODE_BLOCK_TAG = /<(\/?)(?:pre|code)\b/gi
const BLOCK_TAG = /<\/?(?:p|div|ul|ol|li|h[1-6]|pre|blockquote|table|hr|figure|section|article)\b/i

function codeDepthDelta(line: string): number {
  let delta = 0
  for (const match of line.matchAll(CODE_BLOCK_TAG)) delta += match[1] ? -1 : 1
  return delta
}

function quotedLinesToBlockquote(value: string): string {
  if (!value.includes('>')) return value
  let converted = false
  const blocks = value.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((paragraph) => {
    const parts: string[] = []
    let text: string[] = []
    let quoted: string[] | null = null
    let codeDepth = 0
    const flushText = () => {
      const lines = text
      text = []
      const body = lines.join('\n')
      if (!body.trim()) return
      parts.push(BLOCK_TAG.test(body) ? body : `<p>${body.replace(/\n/g, '<br>')}</p>`)
    }
    const flushQuote = () => {
      if (!quoted) return
      const body = quoted.join('<br>')
      quoted = null
      if (!body.trim()) return
      parts.push(`<blockquote><p>${body}</p></blockquote>`)
      converted = true
    }
    for (const line of paragraph.split('\n')) {
      if (codeDepth === 0) {
        const match = QUOTED_LINE.exec(line)
        if (match) {
          flushText()
          ;(quoted ??= []).push(match[1].trim())
          continue
        }
      }
      flushQuote()
      codeDepth = Math.max(0, codeDepth + codeDepthDelta(line))
      text.push(line)
    }
    flushQuote()
    flushText()
    return parts.join('')
  })
  return converted ? blocks.join('') : value
}

export function formatRichTextInput(
  value: string,
  contentType?: 'html' | 'markdown'
): string {
  if (contentType === 'html') return quotedLinesToBlockquote(value)
  if (contentType === 'markdown' || hasMarkdownStructure(value)) {
    return markdownToHtml(value)
  }
  return quotedLinesToBlockquote(value)
}

export function markdownToHtml(markdown: string): string {
  if (markdown.trim().length === 0) return ''
  return normalizeBlockHtml(sanitizeRichHtml((marked.parse(markdown) as string).trim()))
}
