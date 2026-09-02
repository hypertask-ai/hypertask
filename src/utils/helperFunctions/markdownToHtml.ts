import { Marked } from 'marked'
import { escapeHtml } from './escapeHtml'
import { sanitizeRichHtml } from './sanitizeRichHtml'

// Images crash the Tiptap editor (HTPR-4427) — render as a plain link instead of <img>.
// No usable href (e.g. `![alt]()`) falls back to bare alt text rather than a dead anchor.
export function renderMarkdownImage({ href, text }: { href?: string; text?: string }): string {
  const label = escapeHtml(text || href || '')
  if (!href) return label
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
}

// react-dom/server must not be imported anywhere in the App Router graph — Next refuses
// to build it — so this renders markdown straight to an HTML string instead of via JSX.
const marked = new Marked({ gfm: true, async: false })
marked.use({
  renderer: {
    image: renderMarkdownImage,
    // Raw HTML in markdown source is neutralized as visible text, never rendered live.
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

export function formatRichTextInput(
  value: string,
  contentType?: 'html' | 'markdown'
): string {
  if (contentType === 'html') return value
  if (contentType === 'markdown' || hasMarkdownStructure(value)) {
    return markdownToHtml(value)
  }
  return value
}

export function markdownToHtml(markdown: string): string {
  if (markdown.trim().length === 0) return ''
  return sanitizeRichHtml((marked.parse(markdown) as string).trim())
}
