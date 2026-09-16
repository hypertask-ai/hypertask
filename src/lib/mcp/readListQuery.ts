import { NextResponse } from 'next/server'
import {
  applyCollectionQuery,
  ListQueryParseError,
  parseListQueryFromSearchParams,
  type ParsedListQuery,
} from './listQuery'

function listQueryValidationError(message: string): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: 'Validation error',
      message,
    },
    { status: 400 },
  )
}

export function readEnabledListQuery(
  enabled: boolean,
  searchParams: URLSearchParams,
): { listQuery: ParsedListQuery | null; error?: NextResponse } {
  if (!enabled) return { listQuery: null }
  try {
    return { listQuery: parseListQueryFromSearchParams(searchParams) }
  } catch (error) {
    if (error instanceof ListQueryParseError) {
      return {
        listQuery: null,
        error: listQueryValidationError(error.message),
      }
    }
    throw error
  }
}

export function tryApplyCollectionQuery<T extends Record<string, unknown>>(
  items: T[],
  listQuery: ParsedListQuery,
  options: { searchFields: string[]; idField?: string } = { searchFields: [] },
):
  | { ok: true; value: ReturnType<typeof applyCollectionQuery> }
  | { ok: false; error: NextResponse } {
  try {
    return { ok: true, value: applyCollectionQuery(items, listQuery, options) }
  } catch (error) {
    if (error instanceof ListQueryParseError) {
      return { ok: false, error: listQueryValidationError(error.message) }
    }
    throw error
  }
}
