import { test as setup } from '@playwright/test'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { ensureQaRunnerBoard, sweepStaleQaTasks, BoardNotOwnedSolelyError } from './lib/boardSetup'

// Runs once, before the write-journey tests (Playwright project
// dependency in playwright.config.smoke.ts), never in parallel with them ,
// find-or-create races if two workers do it at once. Writes the resolved
// board to a state file the journeys read instead of each re-resolving it.
const BOARD_STATE_FILE = path.join(__dirname, '.state', 'qa-board.json')

setup('find or create the QA runner board', async ({ request }) => {
  setup.skip(process.env.HT_QA_JOURNEYS !== '1', 'HT_QA_JOURNEYS not set, write journeys are opt-in')

  let board
  try {
    board = await ensureQaRunnerBoard(request)
  } catch (err) {
    if (err instanceof BoardNotOwnedSolelyError) {
      // Fails loud rather than silently skipping: a shared board means the
      // owner's write approval doesn't apply, and that's worth a red run.
      throw err
    }
    throw err
  }

  const removed = await sweepStaleQaTasks(request, board.projectId)
  if (removed > 0) console.log(`[qa-setup] swept ${removed} stale [qa-runner] task(s) older than 1h`)

  mkdirSync(path.dirname(BOARD_STATE_FILE), { recursive: true })
  writeFileSync(BOARD_STATE_FILE, JSON.stringify(board))
})
