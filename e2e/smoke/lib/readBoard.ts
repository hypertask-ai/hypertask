import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { QaRunnerBoard } from './boardSetup'

const BOARD_STATE_FILE = path.join(__dirname, '..', '.state', 'qa-board.json')

// Read by the write journeys; written once by journeys.setup.ts (a
// Playwright project dependency, so it always runs first when it runs at
// all). Returns undefined when the setup project didn't run (HT_QA_JOURNEYS
// unset) or was skipped for BoardNotOwnedSolelyError before writing the
// file, either way, tests using this should call test.skip themselves.
export function readQaRunnerBoard(): QaRunnerBoard | undefined {
  if (!existsSync(BOARD_STATE_FILE)) return undefined
  try {
    return JSON.parse(readFileSync(BOARD_STATE_FILE, 'utf8'))
  } catch {
    return undefined
  }
}
