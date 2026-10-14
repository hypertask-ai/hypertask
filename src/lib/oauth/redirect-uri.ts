export function isValidRedirectUri(uri: string): boolean {
  if (!uri || typeof uri !== 'string') {
    return false
  }

  try {
    const url = new URL(uri)
    if (url.hash || url.username || url.password || !url.hostname) {
      return false
    }

    const isLocalhost =
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
      url.protocol === 'http:'
    const isHttps = url.protocol === 'https:'
    const isCustomScheme =
      /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) &&
      !new Set(['http:', 'https:', 'javascript:', 'data:', 'file:', 'blob:']).has(
        url.protocol,
      )

    return isLocalhost || isHttps || isCustomScheme
  } catch {
    return false
  }
}

export function buildRedirectUrl(redirectUri: string, params: Record<string, string>): string {
  const customSchemePattern = /^[a-z][a-z0-9+.-]*:\/\//
  if (customSchemePattern.test(redirectUri.toLowerCase())) {
    const queryString = new URLSearchParams(params).toString()
    const separator = redirectUri.includes('?') ? '&' : '?'
    return `${redirectUri}${separator}${queryString}`
  }

  try {
    const url = new URL(redirectUri)
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value)
    })
    return url.toString()
  } catch (error) {
    const queryString = new URLSearchParams(params).toString()
    const separator = redirectUri.includes('?') ? '&' : '?'
    return `${redirectUri}${separator}${queryString}`
  }
}
