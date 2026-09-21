// Assert-based demo because this repository has no Vitest setup.
// Run after installing dependencies: npx tsx src/lib/mcp/tasks/contractFields.test.ts
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import {
  normalizeRiskLevel,
  parseContractFieldsInput,
} from '@/lib/mcp/tasks/contractFields'

function makeTask(
  id: number,
  contractFields: {
    riskLevel?: 'Low' | 'Medium' | 'High' | null
    acceptanceCriteria?: string | null
    verifyCommand?: string | null
  } = {}
) {
  const timestamp = new Date('2026-07-27T12:00:00.000Z')
  return {
    id,
    ticketNumber: `HTPR-${id}`,
    uniqueIndex: id,
    title: `Task ${id}`,
    description: '',
    description_: null,
    descriptionJson: null,
    section: 'Todo',
    sectionId: 10,
    sectionChangedAt: timestamp,
    lastCommentAt: null,
    parentTaskId: null,
    parentTask: null,
    subTasks: [],
    projectId: 20,
    project: { id: 20, title: 'Test board' },
    status: 'Normal' as const,
    priority: null,
    estimate: null,
    dueDate: null,
    riskLevel: contractFields.riskLevel ?? null,
    acceptanceCriteria: contractFields.acceptanceCriteria ?? null,
    verifyCommand: contractFields.verifyCommand ?? null,
    agent: null,
    assignees: [],
    followers: [],
    taskLabels: [],
    attachments: [],
    _count: { comments: 0 },
    user: {
      id: 6,
      email: 'valentin@example.com',
      displayName: 'Valentin',
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>
}

async function demo() {
  assert.equal(normalizeRiskLevel('Low'), 'Low')
  assert.equal(normalizeRiskLevel('medium'), 'Medium')
  assert.equal(normalizeRiskLevel('HiGh'), 'High')
  assert.equal(normalizeRiskLevel('garbage'), null)

  assert.deepEqual(
    parseContractFieldsInput({
      risk_level: 'high',
      acceptance_criteria: '  All checks pass  ',
      verify_command: '  npm test  ',
    }),
    {
      ok: true,
      value: {
        riskLevel: 'High',
        acceptanceCriteria: 'All checks pass',
        verifyCommand: 'npm test',
      },
    }
  )
  assert.deepEqual(
    parseContractFieldsInput({
      acceptance_criteria: '   ',
      verify_command: '',
    }),
    {
      ok: true,
      value: {
        acceptanceCriteria: null,
        verifyCommand: null,
      },
    }
  )

  const invalidRisk = parseContractFieldsInput({ risk_level: 'critical' })
  assert.equal(invalidRisk.ok, false)
  if (!invalidRisk.ok) assert.equal(invalidRisk.field, 'risk_level')

  const longAcceptance = parseContractFieldsInput({
    acceptance_criteria: 'x'.repeat(5001),
  })
  assert.equal(longAcceptance.ok, false)
  if (!longAcceptance.ok) {
    assert.equal(longAcceptance.field, 'acceptance_criteria')
  }

  const longVerifyCommand = parseContractFieldsInput({
    verify_command: 'x'.repeat(2001),
  })
  assert.equal(longVerifyCommand.ok, false)
  if (!longVerifyCommand.ok) {
    assert.equal(longVerifyCommand.field, 'verify_command')
  }

  process.env.DATABASE_URL =
    'postgresql://unused:unused@localhost:5432/unused'
  process.env.SESSION_SECRET = 'contract-fields-test-session-secret'

  const [
    { default: prisma },
    { executeTaskUpdate },
    { handleBatchBody },
  ] = await Promise.all([
    import('@/lib/prisma'),
    import('@/lib/mcp/tasks/updateTask'),
    import('@/lib/mcp/tasks/batchTasks'),
  ])

  const prismaMock = prisma as any
  const originalTaskFindMany = prismaMock.task.findMany
  const originalTaskUpdate = prismaMock.task.update
  const originalUserFindUnique = prismaMock.user.findUnique
  const request = new NextRequest(
    'http://localhost/api/mcp/tasks/update',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
    }
  )
  const ctx = {
    user: { id: 6, email: 'valentin@example.com' },
    agentId: null,
  }
  let storedContractFields: {
    riskLevel: 'Low' | 'Medium' | 'High' | null
    acceptanceCriteria: string | null
    verifyCommand: string | null
  } = {
    riskLevel: null,
    acceptanceCriteria: null,
    verifyCommand: null,
  }
  const updateCalls: Array<Record<string, any>> = []

  try {
    prismaMock.user.findUnique = async () => ({
      id: 6,
      email: 'valentin@example.com',
      displayName: 'Valentin',
      photoURL: null,
    })
    prismaMock.task.findMany = async (args: Record<string, any>) => {
      if (args.where.OR) {
        return [{ id: 1, sectionId: 10, projectId: 20 }]
      }
      if (args.where.id?.in) {
        return [makeTask(1, storedContractFields)]
      }
      throw new Error('Unexpected task.findMany call')
    }
    prismaMock.task.update = async (args: Record<string, any>) => {
      updateCalls.push(args)
      storedContractFields = {
        ...storedContractFields,
        ...args.data,
      }
      return makeTask(args.where.id, storedContractFields)
    }

    const execution = await executeTaskUpdate({
      request,
      ctx,
      requestBody: {
        task_id: 1,
        risk_level: 'high',
        acceptance_criteria: 'x',
        verify_command: 'npm test',
      },
    })
    const updateBody = await json(execution.response)
    assert.equal(execution.response.status, 200)
    assert.deepEqual(updateCalls[0].data, {
      riskLevel: 'High',
      acceptanceCriteria: 'x',
      verifyCommand: 'npm test',
    })
    assert.equal(updateBody.task.riskLevel, 'high')
    assert.equal(updateBody.task.acceptanceCriteria, 'x')
    assert.equal(updateBody.task.verifyCommand, 'npm test')

    storedContractFields = {
      riskLevel: null,
      acceptanceCriteria: null,
      verifyCommand: null,
    }
    const batchResponse = await handleBatchBody(request, ctx, {
      op: 'update',
      updates: [
        {
          task_id: 1,
          risk_level: 'medium',
          acceptance_criteria: 'Batch criteria',
          verify_command: 'npm run build',
        },
      ],
    })
    const batchBody = await json(batchResponse)
    assert.equal(batchResponse.status, 200)
    assert.equal(batchBody.results[0].success, true)
    assert.equal(batchBody.results[0].task.riskLevel, 'medium')
    assert.deepEqual(updateCalls[1].data, {
      riskLevel: 'Medium',
      acceptanceCriteria: 'Batch criteria',
      verifyCommand: 'npm run build',
    })
  } finally {
    prismaMock.task.findMany = originalTaskFindMany
    prismaMock.task.update = originalTaskUpdate
    prismaMock.user.findUnique = originalUserFindUnique
  }
}

void demo().then(() => {
  console.log('contractFields.test.ts: all assertions passed')
})
