import { NextResponse } from 'next/server'
import { buildFieldError } from '@/lib/mcp/fieldError'

export type JsonBodyResult<T> =
  | { ok: true; body: T }
  | { ok: false; response: NextResponse }

/**
 * Reads a JSON object body, turning a malformed payload into a 400 instead of
 * an unhandled SyntaxError. A client that interpolates an undefined variable
 * into a JSON template sends something like `{"task_id":,"title":""}`, and an
 * unguarded `request.json()` crashed the route with a 500 (HTPR-5568).
 */
export async function readJsonBody<T>(
  request: Request
): Promise<JsonBodyResult<T>> {
  let parsed: unknown
  try {
    parsed = await request.json()
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
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
      response: NextResponse.json(
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
