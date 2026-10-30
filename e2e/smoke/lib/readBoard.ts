import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { QaRunnerBoard } from './boardSetup'

const BOARD_STATE_FILE = path.join(__dirname, '..', '.state', 'qa-board.json')

export function readQaRunnerBoard(): QaRunnerBoard | undefined {
  if (!existsSync(BOARD_STATE_FILE)) return undefined
  try {
    return JSON.parse(readFileSync(BOARD_STATE_FILE, 'utf8'))
  } catch {
    return undefined
  }
}
