import assert from 'node:assert/strict'

async function main() {
  process.env.DATABASE_URL = 'postgresql://unused:unused@localhost:5432/unused'
  const { describeUsagePersistenceError } = await import('@/app/api/ai/_lib/aiUsage')

  const missingColumn = Object.assign(new Error('Invalid invocation: private-prompt-text'), {
    name: 'PrismaClientKnownRequestError',
    code: 'P2022',
    meta: { modelName: 'AiUsage', column: 'cachedInputTokens', value: 'row-value-123' },
  })
  const extra = describeUsagePersistenceError(missingColumn)
  assert.deepEqual(extra, {
    errorName: 'PrismaClientKnownRequestError',
    prismaCode: 'P2022',
    meta_modelName: 'AiUsage',
    meta_column: 'cachedInputTokens',
  })

  const unique = describeUsagePersistenceError(
    Object.assign(new Error('x'), { code: 'P2002', meta: { target: ['traceId', 'userId'] } }),
  )
  assert.equal(unique.meta_target, 'traceId,userId')

  const hostile = describeUsagePersistenceError({
    code: 'P2010',
    meta: { column: 'user@example.com has a long value with !!! chars' },
  })
  assert.deepEqual(hostile, { prismaCode: 'P2010' })
  assert.deepEqual(describeUsagePersistenceError(undefined), {})
  assert.ok(!JSON.stringify(extra).includes('row-value-123'))
  assert.ok(!JSON.stringify(extra).includes('private-prompt-text'))
  console.log('ai usage persistence error tests passed')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
