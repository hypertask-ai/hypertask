import TurndownService from 'turndown'

const turndown = new TurndownService({
  bulletListMarker: '-',
  headingStyle: 'atx',
})

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html)
}
