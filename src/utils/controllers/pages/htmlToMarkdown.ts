import TurndownService from 'turndown'

const turndown = new TurndownService({
  bulletListMarker: '-',
  headingStyle: 'atx',
})

const tableTurndown = new TurndownService({
  bulletListMarker: '-',
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
})

const CELL_TAGS = ['th', 'td']
const ROW_GROUP_TAGS = ['thead', 'tbody', 'tfoot']

function tagOf(element: Element): string {
  return element.tagName.toLowerCase()
}

function directChildren(element: Element, tags: string[]): Element[] {
  return Array.from(element.children).filter((child) => tags.includes(tagOf(child)))
}

function ownRows(table: Element): Element[] {
  const rows: Element[] = []
  const collect = (element: Element) => {
    for (const child of Array.from(element.children)) {
      const tag = tagOf(child)
      if (tag === 'tr') rows.push(child)
      else if (ROW_GROUP_TAGS.includes(tag)) collect(child)
    }
  }
  collect(table)
  return rows
}

function cellText(cell: Element): string {
  return tableTurndown
    .turndown(cell.innerHTML)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\s*\n+\s*/g, ' ')
    .trim()
}

tableTurndown.addRule('table', {
  filter: 'table',
  replacement: (_content, node) => {
    const table = node as unknown as Element
    const rows = ownRows(table)
      .map((row) => directChildren(row, CELL_TAGS).map(cellText))
      .filter((cells) => cells.length > 0)
    if (rows.length === 0) return ''
    const columns = Math.max(...rows.map((cells) => cells.length))
    const line = (cells: string[]) =>
      `| ${Array.from({ length: columns }, (_, index) => cells[index] ?? '').join(' | ')} |`
    const [header, ...body] = rows
    const [caption] = directChildren(table, ['caption'])
    const captionText = caption
      ? tableTurndown.turndown(caption.innerHTML).replace(/\s*\n+\s*/g, ' ').trim()
      : ''
    const lines = [line(header), line(Array(columns).fill('---')), ...body.map(line)]
    return `\n\n${captionText ? `${captionText}\n\n` : ''}${lines.join('\n')}\n\n`
  },
})

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html)
}

export function htmlToMarkdownWithTables(html: string): string {
  return tableTurndown.turndown(html)
}
