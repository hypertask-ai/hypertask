import { NextResponse } from 'next/server'
import {
  ListQueryParseError,
  parseListQueryFromSearchParams,
  type ParsedListQuery,
} from './listQuery'

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
        error: NextResponse.json(
          {
            success: false,
            error: 'Validation error',
            message: error.message,
          },
          { status: 400 },
        ),
      }
    }
    throw error
  }
}
