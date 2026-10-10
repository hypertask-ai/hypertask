// Layout lock matrix (YPER4-252): the same page parts, compared at every width and sidebar state.
import type { Box } from './layout-lock'

// flowY: the vertical position depends on scroll or on how tall earlier content is (a long thread, a phone page
// that opens scrolled), so only x, width and the relations to fixed parts are compared.
export type Anchor = { selector: string; box: Box; contentHeight?: boolean; flowY?: boolean }
export type Anchors = Record<string, Anchor>
export type MatrixState = { ai: 'open' | 'closed'; rail: 'expanded' | 'collapsed' }
export type MatrixFlagChange = { flag: string; ticket: string; page: string; anchors: string[]; reason: string; approvedIn: string }
export type MatrixFlagChanges = { entries: readonly MatrixFlagChange[]; registry: readonly string[]; flags: Record<string, boolean> }

export const MATRIX_WIDTHS = [1920, 1440, 1280, 1100, 950, 768, 390] as const
export const MATRIX_STATES: MatrixState[] = [
  { ai: 'closed', rail: 'expanded' },
  { ai: 'closed', rail: 'collapsed' },
  { ai: 'open', rail: 'expanded' },
  { ai: 'open', rail: 'collapsed' },
]
// "A few pixels" (YPER4-252). The older layout-lock spec keeps its looser 24px.
export const MATRIX_TOLERANCE = 8
const EDGE = 2
export const MATRIX_CHANGE_MESSAGE = "Layout moved. If the ticket asked for this change, update e2e/smoke/layout-lock-matrix.baseline.json, add the page to its approvedIn map with the ticket where Valentin approved it, and put 'Layout change approved: <that ticket URL>' in the PR body."

export const stateKey = (state: MatrixState) => `ai-${state.ai}|rail-${state.rail}`
export function describeCombo(page: string, width: number, state: MatrixState) {
  return `${page} @ ${width}px, AI sidebar ${state.ai === 'open' ? 'open' : 'closed'}, left sidebar ${state.rail}`
}

type Relation = { a: string; b: string; kind: 'left-of' | 'above' }
const right = (box: Box) => box.x + box.width
const bottom = (box: Box) => box.y + box.height
const overlapsVertically = (a: Box, b: Box) => a.y < bottom(b) - EDGE && b.y < bottom(a) - EDGE
const overlapsHorizontally = (a: Box, b: Box) => a.x < right(b) - EDGE && b.x < right(a) - EDGE

// Which parts sit side by side (same row, one left of the other) or stacked (one above the other).
export function relations(boxes: Record<string, Box>): Relation[] {
  const names = Object.keys(boxes).sort()
  const found: Relation[] = []
  for (const first of names) {
    for (const second of names) {
      if (first === second) continue
      const a = boxes[first]
      const b = boxes[second]
      if (overlapsVertically(a, b) && right(a) <= b.x + EDGE && !overlapsHorizontally(a, b)) found.push({ a: first, b: second, kind: 'left-of' })
      else if (overlapsHorizontally(a, b) && bottom(a) <= b.y + EDGE && !overlapsVertically(a, b)) found.push({ a: first, b: second, kind: 'above' })
    }
  }
  return found
}

export function anchorBoxes(anchors: Anchors): Record<string, Box> {
  return Object.fromEntries(Object.entries(anchors).map(([name, anchor]) => [name, anchor.box]))
}

export function matrixDifferences(
  label: string,
  page: string,
  baseline: Anchors,
  actual: Record<string, Box | null>,
  flagChanges?: MatrixFlagChanges,
): string[] {
  const failures: string[] = []
  const report = (name: string, reason: string) => {
    if (flagChanges?.entries.some(entry => entry.page === page && entry.anchors.includes(name) && flagChanges.registry.includes(entry.flag) && flagChanges.flags[entry.flag] === true)) return
    failures.push(`${label}: ${name} ${reason}`)
  }
  const present: Record<string, Box> = {}
  for (const [name, anchor] of Object.entries(baseline)) {
    const box = actual[name]
    if (!box || box.width <= 0 || box.height <= 0) {
      report(name, `disappeared (was ${anchor.box.x},${anchor.box.y} ${anchor.box.width}x${anchor.box.height})`)
      continue
    }
    present[name] = box
  }
  // Relational checks first: they name the cause, the displacement lines below give the numbers.
  const fixed = Object.fromEntries(Object.entries(baseline).filter(([, anchor]) => !anchor.flowY).map(([name, anchor]) => [name, anchor.box]))
  for (const relation of relations(fixed)) {
    const a = present[relation.a]
    const b = present[relation.b]
    if (!a || !b) continue
    if (relation.kind === 'left-of') {
      if (overlapsHorizontally(a, b) && b.y >= bottom(a) - EDGE) report(relation.b, `wrapped below ${relation.a}`)
      else if (right(a) > b.x + EDGE) report(relation.b, `changed column (no longer right of ${relation.a})`)
    } else if (bottom(b) <= a.y + EDGE) {
      report(relation.a, `moved below ${relation.b} (order flipped)`)
    }
  }
  for (const [name, anchor] of Object.entries(baseline)) {
    const box = present[name]
    if (!box) continue
    const dx = box.x - anchor.box.x
    const dy = box.y - anchor.box.y
    if (Math.abs(dx) > MATRIX_TOLERANCE || (!anchor.flowY && Math.abs(dy) > MATRIX_TOLERANCE)) report(name, `moved ${dx},${anchor.flowY ? 0 : dy}px`)
    const dw = box.width - anchor.box.width
    const dh = box.height - anchor.box.height
    if (Math.abs(dw) > MATRIX_TOLERANCE || (!anchor.contentHeight && Math.abs(dh) > MATRIX_TOLERANCE)) report(name, `resized ${dw},${anchor.contentHeight ? 0 : dh}px`)
  }
  return failures
}

export function validateMatrixFlagChanges(entries: readonly MatrixFlagChange[], registry: readonly string[], pages: readonly string[]): string[] {
  const failures: string[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    if (!registry.includes(entry.flag)) failures.push(`${entry.page}: ${entry.flag}: flag no longer exists in the registry. Remove its layout-lock-matrix.flag-changes.json entry.`)
    const ticketNumber = /^htpr-(\d+)-/.exec(entry.flag)?.[1]
    if (!ticketNumber || entry.ticket !== `https://app.hypertask.ai/detail/project-15/${ticketNumber}` || !entry.reason?.trim()) {
      failures.push(`${entry.page}: ${entry.flag}: list the flag's full ticket URL and the requested layout change as the reason.`)
    }
    if (!/^https:\/\/app\.hypertask\.ai\/detail\/project-\d+\/\d+$/.test(entry.approvedIn ?? '')) {
      failures.push(`${entry.page}: ${entry.flag}: approvedIn must be the full URL of the ticket where Valentin approved this layout change.`)
    }
    if (!pages.includes(entry.page) || !Array.isArray(entry.anchors) || !entry.anchors.length || new Set(entry.anchors).size !== entry.anchors.length) {
      failures.push(`${entry.page}: ${entry.flag}: list a known page and unique anchor names.`)
    }
    const key = `${entry.flag}/${entry.page}`
    if (seen.has(key)) failures.push(`${entry.page}: ${entry.flag}: duplicate flag change entry.`)
    seen.add(key)
  }
  return failures
}

// The composer is the last thing of a ticket thread: no comment may end below its top edge.
export function composerFollowsComments(label: string, composerTop: number, lastCommentBottom: number | null): string[] {
  if (lastCommentBottom === null) return []
  return lastCommentBottom > composerTop + EDGE
    ? [`${label}: composer is no longer the last part of the thread (last comment ends at ${lastCommentBottom}px, composer starts at ${composerTop}px)`]
    : []
}
