import assert from 'node:assert/strict'
import { test } from 'node:test'
import { activeSearchValue, chipQuery, searchChipText, splitSearchChips } from '../src/lib/search/chips'
import { parseSearchQuery } from '../src/lib/search/operators'

test('board chip display omits hash without changing serialized query or parser values', () => {
  for (const operator of ['board', 'in']) {
    for (const value of ['inne', '#inne', '7']) {
      const raw = `-${operator}:${value} login`
      const { chips, text } = splitSearchChips(raw)
      assert.equal(searchChipText(chips[0], '#inne', true), `-${operator}:inne`)
      assert.equal(searchChipText(chips[0], undefined, true), `-${operator}:${value.replace(/^#/, '')}`)
      assert.equal(chipQuery(chips, text), raw)
      assert.equal(parseSearchQuery(raw).filters[operator as 'board' | 'in']?.[0].value, value)
    }
  }
})

test('default chip formatter is byte-identical to legacy for every operator and marker', () => {
  for (const raw of ['board:inne', 'in:#inne', '-in:7', 'from:@Valentin', 'assignee:77', '-label:bug', 'is:open', 'has:attachment', 'after:2026-10-01']) {
    const chip = splitSearchChips(raw).chips[0]
    for (const name of [chip.value, '#inne', '@Valentin', 'A name']) {
      const marker = chip.operator === 'from' || chip.operator === 'assignee' ? '@' : chip.operator === 'in' || chip.operator === 'board' ? '#' : ''
      const legacy = `${chip.negated ? '-' : ''}${chip.operator}:${marker}${marker && name.startsWith(marker) ? name.slice(1) : name}`
      assert.equal(searchChipText(chip, name), legacy)
      assert.equal(searchChipText(chip, name, false), legacy)
      if (marker !== '#') assert.equal(searchChipText(chip, name, true), legacy)
    }
  }
})

test('bare hash still opens board picker and hash-prefixed board values still parse', () => {
  assert.deepEqual(activeSearchValue('#inn'), { operator: 'in', value: 'inn', start: 0 })
  assert.equal(activeSearchValue('in:#inn')?.operator, 'in')
  assert.equal(activeSearchValue('board:#inn')?.value, 'inn')
  const query = parseSearchQuery('board:#inne in:#inne')
  assert.equal(query.filters.board?.[0].value, '#inne')
  assert.equal(query.filters.in?.[0].value, '#inne')
})
