import assert from 'node:assert/strict'
import test from 'node:test'

import { buildGuidedStart } from '@/lib/mcp/hello/guidedStart'
import { TOOL_METADATA } from '@/lib/mcp-server/config/tool-metadata'
import { getCreateTaskInputSchema, getListTasksInputSchema } from '@/lib/mcp-server/validations/task.validation'
import { getBoardPlaybookInputSchema } from '@/lib/mcp-server/validations/project.validation'

const newestBoard = { id: 9142, title: 'Product Launch', name: 'launch' }

test('starts on the newest board with 3 steps for the CLI and for MCP', () => {
  const { startBoard, nextSteps } = buildGuidedStart(newestBoard)
  assert.deepEqual(startBoard, {
    id: 9142,
    title: 'Product Launch',
    boardUrl: 'https://app.hypertask.ai/project?id=9142',
  })
  assert.deepEqual(
    nextSteps.map((s) => [s.step, s.command]),
    [
      ['See the board', 'hypertask task list --project 9142'],
      ['Create a first task', 'hypertask task create --project 9142 --title "My first task"'],
      ['Read the board rules', 'hypertask project playbook 9142'],
    ]
  )
})

test('every MCP step names a real tool and arguments that tool accepts', () => {
  const { nextSteps } = buildGuidedStart(newestBoard)
  const schemas: Record<string, { parse(value: unknown): unknown }> = {
    [TOOL_METADATA.LIST_TASKS.name]: getListTasksInputSchema(),
    [TOOL_METADATA.CREATE_TASK.name]: getCreateTaskInputSchema(),
    [TOOL_METADATA.GET_BOARD_PLAYBOOK.name]: getBoardPlaybookInputSchema(),
  }
  assert.deepEqual(nextSteps.map((s) => s.tool), Object.keys(schemas))
  for (const step of nextSteps) assert.doesNotThrow(() => schemas[step.tool].parse(step.arguments), step.tool)
})

test('no board gives no start board and no steps', () => {
  assert.deepEqual(buildGuidedStart(null), { startBoard: null, nextSteps: [] })
})
