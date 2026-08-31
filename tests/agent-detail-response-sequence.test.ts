import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applySequencedResponse } from '../src/lib/agents/responseSequence'

describe('agent detail response sequencing', () => {
  it('rejects an older response through either id or slug', () => {
    const appliedSequences = new Map<string, number>()
    const applied: string[] = []

    assert.equal(
      applySequencedResponse(
        appliedSequences,
        2,
        ['agent:agent-1', 'agent:planner'],
        () => applied.push('new'),
      ),
      true,
    )
    assert.equal(
      applySequencedResponse(appliedSequences, 1, ['agent:planner'], () =>
        applied.push('old'),
      ),
      false,
    )
    assert.deepEqual(applied, ['new'])
  })

  it('sequences activity independently from the agent snapshot', () => {
    const appliedSequences = new Map<string, number>([['agent:agent-1', 4]])
    let activityApplied = false

    assert.equal(
      applySequencedResponse(
        appliedSequences,
        1,
        ['activity:agent-1'],
        () => {
          activityApplied = true
        },
      ),
      true,
    )
    assert.equal(activityApplied, true)
  })
})
