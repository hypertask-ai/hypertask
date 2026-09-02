/**
 * Validates redirect URIs for OAuth clients
 * Supports:
 * - HTTP localhost (http://localhost:* or http://127.0.0.1:*)
 * - HTTPS URLs (https://*)
 * - Custom URI schemes for native apps (cursor://, claude://, vscode://, etc.)
 * 
 * @param uri - The redirect URI to validate
 * @returns true if the URI is valid, false otherwise
 */
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
    // Invalid URL format
    return false
  }
}

/**
 * Builds a redirect URL with query parameters
 * Handles both standard URLs and custom URI schemes
 * 
 * @param redirectUri - The base redirect URI
 * @param params - Query parameters to add
 * @returns The redirect URI with query parameters appended
 */
export function buildRedirectUrl(redirectUri: string, params: Record<string, string>): string {
  // Check if it's a custom URI scheme
  const customSchemePattern = /^[a-z][a-z0-9+.-]*:\/\//
  if (customSchemePattern.test(redirectUri.toLowerCase())) {
    // For custom URI schemes, append query string directly
    const queryString = new URLSearchParams(params).toString()
    const separator = redirectUri.includes('?') ? '&' : '?'
    return `${redirectUri}${separator}${queryString}`
  }

  // For standard URLs, use URL constructor
  try {
    const url = new URL(redirectUri)
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value)
    })
    return url.toString()
  } catch (error) {
    // Fallback: append query string directly
    const queryString = new URLSearchParams(params).toString()
    const separator = redirectUri.includes('?') ? '&' : '?'
    return `${redirectUri}${separator}${queryString}`
  }
}
