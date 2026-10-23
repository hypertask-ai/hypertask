export function normalizeDbConnectionString(connectionString: string | undefined): string | undefined {
  if (!connectionString) return connectionString
  const queryStart = connectionString.split('#', 1)[0].indexOf('?')
  if (queryStart === -1) return connectionString
  const queryEnd = connectionString.indexOf('#', queryStart)
  const end = queryEnd === -1 ? connectionString.length : queryEnd
  const query = connectionString.slice(queryStart + 1, end)
  if (new URLSearchParams(query).has('uselibpqcompat')) return connectionString

  const normalized = query.split('&').map(param => {
    const mode = new URLSearchParams(param).get('sslmode')
    if (mode !== 'prefer' && mode !== 'require' && mode !== 'verify-ca') return param
    return param.slice(0, param.indexOf('=') + 1) + 'verify-full'
  }).join('&')
  return connectionString.slice(0, queryStart + 1) + normalized + connectionString.slice(end)
}
