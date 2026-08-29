type TaskCursor = {
  id: number
}

export function encodeCursor(id: number): string {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new RangeError('Cursor id must be a positive safe integer')
  }

  return Buffer.from(JSON.stringify({ id } satisfies TaskCursor), 'utf8').toString('base64')
}

export function decodeCursor(cursor: string | null | undefined): number | null {
  if (!cursor) return null

  const encoded = cursor.trim()
  if (!encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    return null
  }

  try {
    const decoded = Buffer.from(encoded, 'base64')
    if (decoded.toString('base64') !== encoded) return null

    const value: unknown = JSON.parse(decoded.toString('utf8'))
    if (
      typeof value !== 'object' ||
      value === null ||
      !('id' in value) ||
      !Number.isSafeInteger(value.id) ||
      (value.id as number) <= 0
    ) {
      return null
    }

    return value.id as number
  } catch {
    return null
  }
}
