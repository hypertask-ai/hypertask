import assert from 'node:assert/strict'

async function main() {
  process.env.DATABASE_URL = 'postgresql://unused:unused@localhost:5432/unused'
  const { describeUsagePersistenceError } = await import('@/app/api/ai/_lib/aiUsage')
  const { safeErrorExtra } = await import('@/lib/telemetry/errorSanitization')

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

  const nullConstraint = Object.assign(new Error('private-prompt-text'), {
    name: 'PrismaClientKnownRequestError',
    code: 'P2011',
    meta: {
      modelName: 'AiUsage',
      table: 'AiUsage',
      column: 'userId',
      target: ['userId', 'traceId'],
      constraint: 'AiUsage_userId_not_null',
      field_name: 'userId',
      value: 'row-value-123',
      arbitrary: 'private-prompt-text',
    },
  })
  const sanitized = safeErrorExtra({
    route: 'modelProvider',
    stage: 'usage-persistence',
    ...describeUsagePersistenceError(nullConstraint),
    meta_value: 'row-value-123',
    meta_arbitrary: 'private-prompt-text',
    arbitrary: 'private-prompt-text',
  })
  assert.deepEqual(sanitized, {
    ht_route: 'modelProvider',
    ht_stage: 'usage-persistence',
    ht_errorName: 'PrismaClientKnownRequestError',
    ht_prismaCode: 'P2011',
    ht_meta_modelName: 'AiUsage',
    ht_meta_table: 'AiUsage',
    ht_meta_column: 'userId',
    ht_meta_target: 'userId,traceId',
    ht_meta_constraint: 'AiUsage_userId_not_null',
    ht_meta_field_name: 'userId',
  })
  assert.ok(!JSON.stringify(sanitized).includes('row-value-123'))
  assert.ok(!JSON.stringify(sanitized).includes('private-prompt-text'))
  assert.deepEqual(safeErrorExtra(hostile), { ht_prismaCode: 'P2010' })
  assert.deepEqual(safeErrorExtra({ meta_column: 'person@example.com' }), {
    ht_meta_column: '[redacted]',
  })
  assert.ok(!JSON.stringify(extra).includes('row-value-123'))
  assert.ok(!JSON.stringify(extra).includes('private-prompt-text'))
  console.log('ai usage persistence error tests passed')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
