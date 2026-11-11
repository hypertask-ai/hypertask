export const UPSTASH_DAILY_REQUEST_ALARM = 300_000

export type DayCursor = { day: string; startTotal: number }

export function parseTotalCommands(info: string): number | null {
  const match = /^total_commands_processed:(\d+)\s*$/m.exec(info)
  if (!match) return null
  const total = Number(match[1])
  return Number.isSafeInteger(total) && total >= 0 ? total : null
}

export function advanceDayCursor(
  cursor: DayCursor | null,
  day: string,
  total: number,
): { cursor: DayCursor; commandsToday: number | null } {
  if (!Number.isSafeInteger(total) || total < 0 || cursor?.day !== day || total < cursor.startTotal) {
    return { cursor: { day, startTotal: total }, commandsToday: null }
  }
  return { cursor, commandsToday: total - cursor.startTotal }
}

export function shouldFileDailyAlarm(commandsToday: number | null): boolean {
  return commandsToday !== null && commandsToday > UPSTASH_DAILY_REQUEST_ALARM
}
