import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applySequencedError,
  applySequencedResponse,
  invalidateSequencedResponse,
} from '../src/lib/agents/responseSequence'

describe('agent detail response sequencing', () => {
  it('rejects an older response through either id or slug', () => {
    const latestSequences = new Map<string, number>()
    const applied: string[] = []

    assert.equal(
      applySequencedResponse(
        latestSequences,
        2,
        ['agent:agent-1', 'agent:planner'],
        () => applied.push('new'),
      ),
      true,
    )
    assert.equal(
      applySequencedResponse(latestSequences, 1, ['agent:planner'], () =>
        applied.push('old'),
      ),
      false,
    )
    assert.deepEqual(applied, ['new'])
  })

  it('reports current errors without suppressing valid responses', () => {
    const latestSequences = new Map<string, number>()
    const applied: string[] = []

    assert.equal(
      applySequencedError(latestSequences, 2, ['agent:planner'], () =>
        applied.push('new error'),
      ),
      true,
    )
    assert.equal(
      applySequencedResponse(
        latestSequences,
        1,
        ['agent:agent-1', 'agent:planner'],
        () => applied.push('older success'),
      ),
      true,
    )
    assert.equal(
      applySequencedError(latestSequences, 0, ['agent:planner'], () =>
        applied.push('stale error'),
      ),
      false,
    )
    assert.deepEqual(applied, ['new error', 'older success'])
  })

  it('invalidates old activity when the route leaves and returns', () => {
    const latestSequences = new Map<string, number>()
    const applied: string[] = []

    invalidateSequencedResponse(latestSequences, 2, ['activity:agent-1'])

    assert.equal(
      applySequencedResponse(
        latestSequences,
        1,
        ['activity:agent-1'],
        () => applied.push('old agent-1'),
      ),
      false,
    )
    assert.equal(
      applySequencedResponse(
        latestSequences,
        3,
        ['activity:agent-1'],
        () => applied.push('new agent-1'),
      ),
      true,
    )
    assert.deepEqual(applied, ['new agent-1'])
  })
})
