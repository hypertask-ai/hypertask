import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AgentBoardUpdateError,
  parseAgentBoardUpdateBody,
  updateOwnedAgentBoards,
  type AgentBoardUpdateDatabase,
  type AgentBoardUpdateInput,
} from '../src/lib/mcp/agents/updateBoards'

type Membership = { projectId: number; project: { teamId: string | null } }

function fakeDatabase(
  agent: { id: string; userId: number; members: Membership[] } | null,
  serializationFailures = 0
) {
  const created: Array<Record<string, unknown>> = []
  const removed: number[] = []
  const isolationLevels: string[] = []
  let transactionAttempts = 0
  const database: AgentBoardUpdateDatabase = {
    $transaction: async (run, options) => {
      transactionAttempts += 1
      isolationLevels.push(options.isolationLevel)
      if (transactionAttempts <= serializationFailures) throw { code: 'P2034' }
      return run({
        agent: { findFirst: async () => agent },
        member: {
          deleteMany: async ({ where }) => {
            removed.push(...where.projectId.in)
            return {
              count: agent?.members.filter(({ projectId }) =>
                where.projectId.in.includes(projectId)
              ).length ?? 0,
            }
          },
          createMany: async ({ data }) => {
            created.push(...data)
            return { count: data.length }
          },
        },
      })
    },
  }
  return {
    database,
    created,
    removed,
    isolationLevels,
    transactionAttempts: () => transactionAttempts,
  }
}

const update = (
  agentId: string,
  addProjectIds: number[],
  removeProjectIds: number[]
): AgentBoardUpdateInput => ({ agentId, addProjectIds, removeProjectIds })

async function expectError(promise: Promise<unknown>, status: number, field: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AgentBoardUpdateError)
    assert.equal(error.status, status)
    assert.equal(error.field, field)
    return true
  })
}

describe('agent board membership update input', () => {
  it('normalizes project lists and rejects unsafe combinations', () => {
    assert.deepEqual(
      parseAgentBoardUpdateBody({
        agent_id: ' agent-1 ',
        add_project_ids: [339, 339],
        remove_project_ids: [2312],
      }),
      update('agent-1', [339], [2312])
    )
    for (const body of [
      { agent_id: 'agent-1' },
      { agent_id: 'agent-1', add_project_ids: [0] },
      { agent_id: 'agent-1', add_project_ids: [339], remove_project_ids: [339] },
    ]) {
      assert.throws(
        () => parseAgentBoardUpdateBody(body),
        (error: unknown) => error instanceof AgentBoardUpdateError && error.status === 400
      )
    }
  })
})

describe('owned agent board membership updates', () => {
  it('adds and removes memberships in one transaction', async () => {
    const state = fakeDatabase({
      id: 'agent-1',
      userId: 6,
      members: [
        { projectId: 2312, project: { teamId: 'inne' } },
        { projectId: 15, project: { teamId: 'inne' } },
      ],
    })
    const result = await updateOwnedAgentBoards(
      state.database,
      async (id) => ({ id, teamId: 'inne' }),
      6,
      update('agent-1', [339], [2312])
    )
    assert.deepEqual(state.isolationLevels, ['Serializable'])
    assert.deepEqual(state.removed, [2312])
    assert.deepEqual(state.created, [
      { projectId: 339, userId: 6, agentId: 'agent-1' },
    ])
    assert.deepEqual(result, {
      agentId: 'agent-1',
      addedProjects: 1,
      removedProjects: 1,
    })
  })

  it('retries serialization conflicts before writing', async () => {
    const state = fakeDatabase(
      { id: 'agent-1', userId: 6, members: [] },
      2
    )
    const result = await updateOwnedAgentBoards(
      state.database,
      async (id) => ({ id, teamId: 'inne' }),
      6,
      update('agent-1', [339], [])
    )
    assert.equal(state.transactionAttempts(), 3)
    assert.deepEqual(state.created, [
      { projectId: 339, userId: 6, agentId: 'agent-1' },
    ])
    assert.equal(result.addedProjects, 1)
  })

  it('makes idempotent retries no-ops', async () => {
    const state = fakeDatabase({
      id: 'agent-1',
      userId: 6,
      members: [{ projectId: 339, project: { teamId: 'inne' } }],
    })
    const result = await updateOwnedAgentBoards(
      state.database,
      async () => { throw new Error('existing memberships need no access check') },
      6,
      update('agent-1', [339], [2312])
    )
    assert.deepEqual(state.created, [])
    assert.deepEqual(state.removed, [])
    assert.equal(result.addedProjects, 0)
    assert.equal(result.removedProjects, 0)
  })

  it('enforces ownership and board access before writing', async () => {
    const missing = fakeDatabase(null)
    await expectError(
      updateOwnedAgentBoards(missing.database, async () => null, 6,
        update('other-agent', [339], [])),
      404,
      'agent_id'
    )
    const inaccessible = fakeDatabase({
      id: 'agent-1', userId: 6,
      members: [{ projectId: 2312, project: { teamId: 'inne' } }],
    })
    await expectError(
      updateOwnedAgentBoards(inaccessible.database, async () => null, 6,
        update('agent-1', [339], [])),
      403,
      'add_project_ids'
    )
    assert.deepEqual(inaccessible.created, [])
    assert.deepEqual(inaccessible.removed, [])
  })

  it('enforces the final team while allowing removal and an atomic team move', async () => {
    const original = { id: 'agent-1', userId: 6, members: [
      { projectId: 2312, project: { teamId: 'inne' } },
    ] }
    const crossTeam = fakeDatabase(original)
    await expectError(
      updateOwnedAgentBoards(crossTeam.database,
        async (id) => ({ id, teamId: 'hypertask' }), 6,
        update('agent-1', [15], [])),
      400,
      'add_project_ids'
    )
    const teamMove = fakeDatabase(original)
    const moved = await updateOwnedAgentBoards(teamMove.database,
      async (id) => ({ id, teamId: 'hypertask' }), 6,
      update('agent-1', [15], [2312]))
    assert.equal(moved.addedProjects, 1)
    assert.equal(moved.removedProjects, 1)

    const legacy = fakeDatabase({
      id: 'agent-1', userId: 6,
      members: [{ projectId: 7, project: { teamId: null } }],
    })
    const removed = await updateOwnedAgentBoards(legacy.database, async () => null, 6,
      update('agent-1', [], [7]))
    assert.equal(removed.removedProjects, 1)
  })
})
