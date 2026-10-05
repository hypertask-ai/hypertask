export type Box = { x: number; y: number; width: number; height: number }
export type Landmark = { selector: string; box: Box; contentHeight?: boolean }
export type Screen = { landmarks: Record<string, Landmark>; order: string[][] }

export const LAYOUT_CHANGE_MESSAGE = "Layout changed. Only change e2e/smoke/layout-lock.baseline.json when the ticket asks for this layout change; put Valentin's quote in the PR."
export const POSITION_TOLERANCE = 24
export const SIZE_TOLERANCE_RATIO = 0.1

// Same-row landmarks have no vertical relationship; keep their names deterministic.
export function verticalOrder(boxes: Record<string, Box>): string[][] {
  const rows: string[][] = []
  let rowY = -Infinity
  for (const [name, box] of Object.entries(boxes).sort(([a, x], [b, y]) => x.y - y.y || a.localeCompare(b))) {
    if (box.y - rowY > 4) {
      rows.push([])
      rowY = box.y
    }
    rows[rows.length - 1].push(name)
  }
  return rows.map(row => row.sort())
}

export function layoutDifferences(screen: string, baseline: Screen, actual: Record<string, Box | null>): string[] {
  const failures: string[] = []
  const report = (name: string, reason: string) => failures.push(
    `${screen}: ${name}: ${reason}; baseline=${JSON.stringify(baseline.landmarks[name]?.box)} actual=${JSON.stringify(actual[name] ?? null)}. ${LAYOUT_CHANGE_MESSAGE}`,
  )
  for (const [name, landmark] of Object.entries(baseline.landmarks)) {
    const box = actual[name]
    if (!box || box.width <= 0 || box.height <= 0) {
      report(name, 'landmark missing or hidden')
      continue
    }
    for (const edge of ['x', 'y', 'width', 'height'] as const) {
      if (edge === 'height' && landmark.contentHeight) continue
      const tolerance = edge === 'x' || edge === 'y'
        ? POSITION_TOLERANCE
        : Math.max(POSITION_TOLERANCE, landmark.box[edge] * SIZE_TOLERANCE_RATIO)
      if (Math.abs(box[edge] - landmark.box[edge]) > tolerance) report(name, `${edge} moved/resized beyond ${Math.round(tolerance * 10) / 10}px`)
    }
  }
  for (let row = 0; row < baseline.order.length; row++) {
    for (const before of baseline.order[row]) {
      for (const after of baseline.order.slice(row + 1).flat()) {
        if (actual[before] && actual[after] && actual[before]!.y > actual[after]!.y) {
          report(after, `vertical order changed: expected ${before} before ${after}`)
        }
      }
    }
  }
  return failures
}
