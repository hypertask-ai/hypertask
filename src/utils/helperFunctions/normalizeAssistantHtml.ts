import { Marked } from 'marked'
import { escapeHtml } from './escapeHtml'
import { renderMarkdownImage } from './markdownToHtml'

const EXECUTABLE_URL_SCHEME = /^\s*(?:javascript|data|vbscript):/i

const WRAPPING_HTML_FENCE = /^```html?[^\n]*\n((?:(?!\n\s*```)[\s\S])*)\n?\s*```\s*$/i

const marked = new Marked({ gfm: true, async: false })
marked.use({
  renderer: {
    image: renderMarkdownImage,
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens)
      if (!href || EXECUTABLE_URL_SCHEME.test(href)) return text
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : ''
      return `<a href="${escapeHtml(href)}"${titleAttr}>${text}</a>`
    },
  },
  tokenizer: {
    code: () => undefined,
  },
})

export function normalizeAssistantHtml(content: string): string {
  const trimmed = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (trimmed.length === 0) return ''
  const unfenced = trimmed.replace(WRAPPING_HTML_FENCE, '$1')
  return (marked.parse(unfenced) as string).trim()
}
