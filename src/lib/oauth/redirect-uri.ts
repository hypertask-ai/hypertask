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

  // Check for custom URI schemes (cursor://, claude://, vscode://, etc.)
  // Custom URI schemes follow the pattern: scheme://path
  // Scheme must start with a letter and can contain letters, numbers, +, -, and .
  const customSchemePattern = /^[a-z][a-z0-9+.-]*:\/\//
  if (customSchemePattern.test(uri.toLowerCase())) {
    // Additional validation: ensure it's a well-formed custom URI
    // Must have at least scheme://path
    const parts = uri.split('://')
    if (parts.length === 2 && parts[0].length > 0 && parts[1].length > 0) {
      return true
    }
    return false
  }

  // For standard URLs, use URL constructor
  try {
    const url = new URL(uri)
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    const isHttps = url.protocol === 'https:'
    
    return isLocalhost || isHttps
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
