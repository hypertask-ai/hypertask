import { NextResponse } from 'next/server'
import { buildFieldError } from '@/lib/mcp/fieldError'

export type JsonBodyResult<T> =
  | { ok: true; body: T }
  | { ok: false; response: NextResponse }

export async function readJsonBody<T>(
  request: Request,
  errors: {
    invalidJson?: () => NextResponse
    invalidObject?: () => NextResponse
  } = {},
): Promise<JsonBodyResult<T>> {
  let parsed: unknown
  try {
    parsed = await request.json()
  } catch {
    return {
      ok: false,
      response: errors.invalidJson?.() ?? NextResponse.json(
        buildFieldError(
          'invalid_field',
          'body',
          'Request body is not valid JSON. Send a JSON object, and check for empty values such as {"task_id":,...}.'
        ),
        { status: 400 }
      ),
    }
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      response: errors.invalidObject?.() ?? NextResponse.json(
        buildFieldError(
          'invalid_field',
          'body',
          'Request body must be a JSON object.'
        ),
        { status: 400 }
      ),
    }
  }

  return { ok: true, body: parsed as T }
}
