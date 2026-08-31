import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applySequencedResponse,
  markSequencedResponse,
} from '../src/lib/agents/responseSequence'

describe('agent detail response sequencing', () => {
  it('rejects an older response through either id or slug', () => {
    const latestSequences = new Map<string, number>()
    const applied: string[] = []

    markSequencedResponse(latestSequences, 2, [
      'agent:agent-1',
      'agent:planner',
    ])
    assert.equal(
      applySequencedResponse(latestSequences, 1, ['agent:planner'], () =>
        applied.push('old'),
      ),
      false,
    )
    assert.equal(
      applySequencedResponse(
        latestSequences,
        2,
        ['agent:agent-1', 'agent:planner'],
        () => applied.push('new'),
      ),
      true,
    )
    assert.deepEqual(applied, ['new'])
  })

  it('invalidates an old activity request across an agent round trip', () => {
    const latestSequences = new Map<string, number>([['agent:agent-1', 4]])
    const applied: string[] = []

    markSequencedResponse(latestSequences, 1, ['activity:agent-1'])
    markSequencedResponse(latestSequences, 2, ['activity:agent-2'])
    markSequencedResponse(latestSequences, 3, ['activity:agent-1'])

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
