import type { NextApiRequest } from 'next'

type RequestWithHeaders = Request | NextApiRequest

const DEFAULT_SITE_URL = 'https://app.hypertask.ai'

const ALLOWED_AUTH_HOSTS = new Set([
  'app.hypertask.ai',
  'staging.hypertask.ai',
  'demo.hypertask.ai',
  'hypertasks-staging.vercel.app',
  'localhost:3000',
  '127.0.0.1:3000',
])

const ALLOWED_PREVIEW_HOST =
  /^hypertasks-(prod|staging)-[a-z0-9-]+-hypertaskai\.vercel\.app$/

function getHeader(req: RequestWithHeaders, name: string): string | undefined {
  const headers = req.headers
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) || undefined
  }

  const value = (headers as NextApiRequest['headers'])[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

function firstHeaderValue(value: string | undefined): string | undefined {
  return value?.split(',')[0]?.trim()
}

function normalizeHost(value: string | undefined): string {
  return firstHeaderValue(value)?.toLowerCase() || ''
}

function normalizeProto(value: string | undefined): 'http' | 'https' {
  const proto = firstHeaderValue(value)?.toLowerCase()
  return proto === 'http' || proto === 'https' ? proto : 'https'
}

function fallbackBaseUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL
}

export function isAllowedAuthHost(host: string): boolean {
  const normalizedHost = normalizeHost(host)
  return (
    ALLOWED_AUTH_HOSTS.has(normalizedHost) ||
    ALLOWED_PREVIEW_HOST.test(normalizedHost)
  )
}

export function getRequestBaseUrl(req: RequestWithHeaders): string {
  const host = normalizeHost(
    getHeader(req, 'x-forwarded-host') || getHeader(req, 'host')
  )

  if (!isAllowedAuthHost(host)) {
    return fallbackBaseUrl()
  }

  const proto = normalizeProto(getHeader(req, 'x-forwarded-proto'))
  return `${proto}://${host}`
}
