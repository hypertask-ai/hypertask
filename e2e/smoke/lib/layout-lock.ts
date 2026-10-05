export type Box = { x: number; y: number; width: number; height: number }
export type Landmark = { selector: string; box: Box; contentHeight?: boolean }
export type Screen = { landmarks: Record<string, Landmark>; order: string[][] }
// bug: set when the flag's ticket never asked for this move; the entry is tracked debt, removed by that bug's fix.
export type FlagChange = { flag: string; ticket: string; screen: string; landmarks: string[]; reason: string; bug?: string }
type FlagChanges = { entries: readonly FlagChange[]; registry: readonly string[]; flags: Record<string, boolean> }

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

export function validateFlagChanges(entries: readonly FlagChange[], registry: readonly string[], screens: Record<string, Screen>): string[] {
  const failures: string[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    if (!registry.includes(entry.flag)) failures.push(`${entry.screen}: ${entry.flag}: flag no longer exists in the registry. Remove its layout-lock.flag-changes.json entry and update the live-like baseline instead.`)
    const ticketNumber = /^htpr-(\d+)-/.exec(entry.flag)?.[1]
    if (!ticketNumber || entry.ticket !== `https://app.hypertask.ai/detail/project-15/${ticketNumber}` || !entry.reason?.trim()) {
      failures.push(`${entry.screen}: ${entry.flag}: list the flag's full ticket URL and the requested layout change as the reason.`)
    }
    if (entry.bug !== undefined && !/^https:\/\/app\.hypertask\.ai\/detail\/project-15\/\d+$/.test(entry.bug)) {
      failures.push(`${entry.screen}: ${entry.flag}: bug must be the full URL of the board 15 bug that removes this entry.`)
    }
    const names = screens[entry.screen]?.landmarks
    if (!names || !Array.isArray(entry.landmarks) || !entry.landmarks.length || entry.landmarks.some(name => !Object.hasOwn(names, name)) || new Set(entry.landmarks).size !== entry.landmarks.length) {
      failures.push(`${entry.screen}: ${entry.flag}: list only existing, unique landmark names for this screen.`)
    }
    const key = `${entry.flag}/${entry.screen}`
    if (seen.has(key)) failures.push(`${entry.screen}: ${entry.flag}: duplicate flag change entry.`)
    seen.add(key)
  }
  return failures
}

export function layoutDifferences(screen: string, baseline: Screen, actual: Record<string, Box | null>, flagChanges?: FlagChanges): string[] {
  const failures: string[] = []
  const report = (name: string, reason: string) => {
    if (flagChanges?.entries.some(entry => entry.screen === screen && entry.landmarks.includes(name) && flagChanges.registry.includes(entry.flag) && flagChanges.flags[entry.flag] === true)) return
    const message = flagChanges
      ? 'All-flags-on layout drift must be listed in e2e/smoke/layout-lock.flag-changes.json under a registered flag with the ticket that asked for this change.'
      : LAYOUT_CHANGE_MESSAGE
    failures.push(`${screen}: ${name}: ${reason}; baseline=${JSON.stringify(baseline.landmarks[name]?.box)} actual=${JSON.stringify(actual[name] ?? null)}. ${message}`)
  }
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
          if (flagChanges) report(before, `vertical order changed: expected ${before} before ${after}`)
          report(after, `vertical order changed: expected ${before} before ${after}`)
        }
      }
    }
  }
  return failures
}
