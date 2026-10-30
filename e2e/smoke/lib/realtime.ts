export function withRealtime(pathOrUrl: string): string {
  return pathOrUrl + (pathOrUrl.includes('?') ? '&' : '?') + 'realtime=on'
}
