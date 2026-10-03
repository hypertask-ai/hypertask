import { NextResponse } from 'next/server'

export function jsonError(error: string, status = 400): NextResponse {
  return NextResponse.json({ error }, { status })
}

export function unauthorized(): NextResponse {
  return jsonError('Unauthorized', 401)
}
