import type { BetterAuthOptions } from 'better-auth'
import type { DBAdapter, DBTransactionAdapter } from '@better-auth/core/db/adapter'
import { decodeOAuthToken, encodeOAuthToken, OAUTH_TOKEN_FIELDS } from './oauthTokenCipher'

type RecordValue = Record<string, unknown>
type Operation = {
  model: string
  data?: RecordValue
  update?: RecordValue
  set?: RecordValue
  increment?: RecordValue
  where?: { field: string }[]
  join?: Record<string, unknown>
  sortBy?: { field: string }
}

function transformTokens(data: RecordValue, encode: boolean): RecordValue {
  const result = { ...data }
  for (const field of OAUTH_TOKEN_FIELDS) {
    if (!Object.hasOwn(data, field)) continue
    const value = data[field]
    if (value != null && typeof value !== 'string') throw new Error('oauth_token_invalid_input')
    result[field] = encode ? encodeOAuthToken(field, value) : decodeOAuthToken(field, value)
  }
  return result
}

export function withOAuthTokenStorage<T extends DBAdapter | DBTransactionAdapter>(adapter: T, options: BetterAuthOptions): T {
  const models = new Set(['account', options.account?.modelName ?? 'account'])
  const fields = new Set<string>(OAUTH_TOKEN_FIELDS)
  for (const field of OAUTH_TOKEN_FIELDS) fields.add(options.account?.fields?.[field] ?? field)
  const methods = new Set(['create', 'findOne', 'findMany', 'count', 'update', 'updateMany', 'delete', 'deleteMany', 'consumeOne', 'incrementOne'])

  function decodeResult(value: unknown, account: boolean): unknown {
    if (Array.isArray(value)) return value.map(item => decodeResult(item, account))
    if (!value || typeof value !== 'object') return value
    const result: RecordValue = account ? transformTokens(value as RecordValue, false) : { ...value }
    if (Object.hasOwn(result, 'account')) result.account = decodeResult(result.account, true)
    return result
  }

  return new Proxy(adapter, {
    get(target, property, receiver) {
      const method = Reflect.get(target, property, receiver)
      if (typeof method !== 'function') return method
      if (property === 'transaction') {
        return (callback: (tx: DBTransactionAdapter) => Promise<unknown>) =>
          method.call(target, (tx: DBTransactionAdapter) => callback(withOAuthTokenStorage(tx, options)))
      }
      if (typeof property !== 'string' || !methods.has(property)) return method.bind(target)
      return async (input: Operation) => {
        const account = models.has(input.model)
        try {
          let data = input
          if (account) {
            if (input.where?.some(where => fields.has(where.field)) || (input.sortBy && fields.has(input.sortBy.field))) {
              throw new Error('oauth_token_predicate_unsupported')
            }
            if (Object.keys(input.increment ?? {}).some(field => fields.has(field))) throw new Error('oauth_token_increment_unsupported')
            data = { ...input }
            for (const key of ['data', 'update', 'set'] as const) {
              if (input[key]) data[key] = transformTokens(input[key], true)
            }
          }
          const result = await method.call(target, data)
          return account || input.join?.account || input.join?.[options.account?.modelName ?? 'account']
            ? decodeResult(result, account)
            : result
        } catch (error) {
          if (!account && !input.join?.account && !input.join?.[options.account?.modelName ?? 'account']) throw error
          throw new Error('oauth_token_storage_failed')
        }
      }
    },
  })
}
