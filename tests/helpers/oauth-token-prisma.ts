import type { PrismaClient } from '@prisma/client'

type Row = Record<string, any>

export function matchesOAuthFixture(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([field, value]) => {
    if (field === 'AND') return (Array.isArray(value) ? value : [value]).every(part => matchesOAuthFixture(row, part))
    if (field === 'OR') return value.some((part: Row) => matchesOAuthFixture(row, part))
    if (field === 'NOT') return !(Array.isArray(value) ? value : [value]).some(part => matchesOAuthFixture(row, part))
    const actual = row[field]
    if (value === null || typeof value !== 'object' || value instanceof Date) {
      return actual instanceof Date && value instanceof Date ? +actual === +value : actual === value
    }
    return Object.entries(value).every(([operator, expected]: [string, any]) => {
      if (operator === 'equals') return actual === expected
      if (operator === 'not') return !matchesOAuthFixture(row, { [field]: expected })
      if (operator === 'startsWith') return typeof actual === 'string' && actual.startsWith(expected)
      if (operator === 'gt') return actual > expected
      if (operator === 'gte') return actual >= expected
      if (operator === 'lt') return actual < expected
      if (operator === 'lte') return actual <= expected
      if (operator === 'in') return expected.includes(actual)
      if (operator === 'notIn') return !expected.includes(actual)
      if (operator === 'mode') return true
      throw new Error('unsupported_fixture_predicate')
    })
  })
}

export function oauthTokenPrisma() {
  const tables: Record<string, Row[]> = { User: [], BetterAuthAccount: [], BetterAuthSession: [], BetterAuthVerification: [] }
  const calls: { model: string; operation: string; args: any; transaction: boolean }[] = []
  let beforeUpdate: ((args: any) => void) | undefined
  let failure: Error | undefined
  function client(transaction: boolean): any {
    const db: any = {}
    for (const [model, rows] of Object.entries(tables)) {
      function project(row: Row | undefined, select?: Row): any {
        if (!row) return null
        if (!select) return structuredClone(row)
        return Object.fromEntries(Object.entries(select).flatMap(([field, enabled]) => {
          if (!enabled) return []
          if (field.toLowerCase() === 'betterauthaccounts') {
            return [[field, tables.BetterAuthAccount.filter(account => account.userId === row.id).map(account => structuredClone(account))]]
          }
          if (field.toLowerCase() === 'user') return [[field, structuredClone(tables.User.find(user => user.id === row.userId))]]
          return Object.hasOwn(row, field) ? [[field, structuredClone(row[field])]] : []
        }))
      }
      function query(args: any = {}) {
        let found = rows.filter(row => matchesOAuthFixture(row, args.where))
        if (args.orderBy) {
          const [field, direction] = Object.entries(args.orderBy)[0]
          found = [...found].sort((a, b) => (a[field] - b[field]) * (direction === 'desc' ? -1 : 1))
        }
        return found.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? found.length))
      }
      function apply(row: Row, data: Row) {
        for (const [field, value] of Object.entries(data)) {
          if (value !== undefined) row[field] = value && typeof value === 'object' && 'increment' in value ? (row[field] ?? 0) + value.increment : value
        }
      }
      const implementations: Record<string, (args: any) => any> = {
        create: ({ data, select }) => {
          const row = { ...(model === 'BetterAuthAccount' ? { accessToken: null, refreshToken: null, idToken: null } : {}), id: rows.length + 1, ...data }
          rows.push(row)
          return project(row, select)
        },
        findFirst: args => project(query(args)[0], args.select),
        findMany: args => query(args).map(row => project(row, args.select)),
        count: args => query(args).length,
        update: ({ where, data }) => {
          beforeUpdate?.({ where, data })
          const row = rows.find(row => matchesOAuthFixture(row, where))
          if (!row) throw Object.assign(new Error('fixture_not_found'), { code: 'P2025' })
          apply(row, data)
          return project(row)
        },
        updateMany: ({ where, data }) => {
          beforeUpdate?.({ where, data })
          const found = rows.filter(row => matchesOAuthFixture(row, where))
          for (const row of found) apply(row, data)
          return { count: found.length }
        },
        delete: ({ where }) => {
          const index = rows.findIndex(row => matchesOAuthFixture(row, where))
          if (index < 0) throw Object.assign(new Error('fixture_not_found'), { code: 'P2025' })
          return structuredClone(rows.splice(index, 1)[0])
        },
        deleteMany: ({ where }) => {
          const found = rows.filter(row => matchesOAuthFixture(row, where))
          for (const row of found) rows.splice(rows.indexOf(row), 1)
          return { count: found.length }
        },
      }
      const delegate = Object.fromEntries(Object.entries(implementations).map(([operation, run]) => [operation, async (args: any = {}) => {
        calls.push({ model, operation, args: structuredClone(args), transaction })
        if (failure) throw failure
        return run(args)
      }]))
      db[model] = delegate
      db[model[0].toLowerCase() + model.slice(1)] = delegate
    }
    db.$transaction = async (run: (tx: any) => Promise<any>) => {
      const snapshots = structuredClone(tables)
      try { return await run(client(true)) } catch (error) {
        for (const [model, snapshot] of Object.entries(snapshots)) tables[model].splice(0, tables[model].length, ...snapshot)
        throw error
      }
    }
    return db
  }
  return {
    db: client(false) as PrismaClient, tables, calls,
    setBeforeUpdate: (hook?: (args: any) => void) => { beforeUpdate = hook },
    setFailure: (error?: Error) => { failure = error },
  }
}
