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

function cellText(cell: Element): string {
  return tableTurndown
    .turndown(cell.innerHTML)
    .replace(/\|/g, '\\|')
    .replace(/\s*\n+\s*/g, ' ')
    .trim()
}

tableTurndown.addRule('table', {
  filter: 'table',
  replacement: (_content, node) => {
    const rows = Array.from((node as unknown as Element).querySelectorAll('tr'))
      .map((row) => Array.from(row.querySelectorAll('th,td')).map(cellText))
      .filter((cells) => cells.length > 0)
    if (rows.length === 0) return ''
    const columns = Math.max(...rows.map((cells) => cells.length))
    const line = (cells: string[]) =>
      `| ${Array.from({ length: columns }, (_, index) => cells[index] ?? '').join(' | ')} |`
    const [header, ...body] = rows
    return `\n\n${[line(header), line(Array(columns).fill('---')), ...body.map(line)].join('\n')}\n\n`
  },
})

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html)
}

export function htmlToMarkdownWithTables(html: string): string {
  return tableTurndown.turndown(html)
}
