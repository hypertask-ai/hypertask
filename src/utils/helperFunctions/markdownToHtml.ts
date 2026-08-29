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

export function markdownToHtml(markdown: string): string {
  if (markdown.trim().length === 0) return ''
  return sanitizeRichHtml((marked.parse(markdown) as string).trim())
}
