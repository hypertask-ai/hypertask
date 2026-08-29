import { Marked } from 'marked'
import { escapeHtml } from './escapeHtml'
import { renderMarkdownImage } from './markdownToHtml'

// Schemes that execute rather than navigate. Converting markdown is what makes this
// necessary: `[click](javascript:...)` is inert text until it becomes a real anchor.
const EXECUTABLE_URL_SCHEME = /^\s*(?:javascript|data|vbscript):/i

// An ```html fence wrapping the WHOLE string, which models add when asked for HTML.
// marked would otherwise render the markup as a visible code block.
// Deliberately narrow: the language must be html (```bash is a real code block the user
// asked for), and an interior fence disqualifies the match, otherwise a message that both
// opens and closes with a fence would have everything between them swallowed.
// `[^\n]*` tolerates a trailing space or info string after the language.
const WRAPPING_HTML_FENCE = /^```html?[^\n]*\n((?:(?!\n\s*```)[\s\S])*)\n?\s*```\s*$/i

// Unlike markdownToHtml, raw HTML is NOT escaped here: assistant output regularly mixes
// real HTML tags with markdown in one string, and both have to survive.
const marked = new Marked({ gfm: true, async: false })
marked.use({
  renderer: {
    image: renderMarkdownImage,
    // marked stopped sanitizing URLs in v5, and this output is written straight into
    // comments and descriptions that render with dangerouslySetInnerHTML. An executable
    // href is dropped to its plain text rather than the whole link disappearing.
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens)
      if (!href || EXECUTABLE_URL_SCHEME.test(href)) return text
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : ''
      return `<a href="${escapeHtml(href)}"${titleAttr}>${text}</a>`
    },
  },
  tokenizer: {
    // Indented code blocks off: models pretty-print nested HTML, and four leading spaces
    // would turn their own markup into a visible code block. Fenced code still works, and
    // nobody writes indented code blocks in a chat box.
    code: () => undefined,
  },
})

// Always parses, never trusts the input to be HTML already. An earlier version returned
// early when it spotted a block tag, which left every mixed HTML+markdown response
// half-raw (HTPR-4687) — the common case, since models drift back to markdown mid-answer.
export function normalizeAssistantHtml(content: string): string {
  // CRLF first, and here rather than at the call site: a markdown list whose lines end in
  // \r\n is not parsed as a list, and \r would also defeat the fence match below.
  const trimmed = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (trimmed.length === 0) return ''
  const unfenced = trimmed.replace(WRAPPING_HTML_FENCE, '$1')
  // ponytail: markdown nested inside an HTML block (`<p>**x**</p>`) stays raw, because
  // marked treats the block as opaque. Handle that only if it shows up in practice.
  return (marked.parse(unfenced) as string).trim()
}
