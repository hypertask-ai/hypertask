import { NextResponse } from 'next/server'
import { ValidationError } from '@/lib/mcp-server/utils/errors'

export const VIEW_LIST_SORT_FIELDS = ['title', 'createdAt', 'lastUsedAt'] as const

export function viewListSortFields(): readonly string[] {
  return VIEW_LIST_SORT_FIELDS
}

export function viewInputRefusal(
  message: string,
  field: string,
  code = 'invalid_value',
  allowed_values?: readonly string[],
) {
  return NextResponse.json(
    {
      success: false,
      error: 'Validation error',
      message,
      details: {
        field,
        code,
        ...(allowed_values?.length ? { allowed_values: [...allowed_values] } : {}),
      },
    },
    { status: 400 },
  )
}

const MESSAGE_REFUSALS: Array<{
  test: RegExp
  field: string
  code?: string
  allowed_values?: readonly string[]
}> = [
  { test: /^A view titled .+ already exists/, field: 'title', code: 'invalid_value' },
  { test: /^Label\(s\) not found/, field: 'label_names', code: 'invalid_value' },
  { test: /^assignee .+ is neither a project member/, field: 'assignee_ids', code: 'invalid_value' },
  { test: /^View does not exist$/, field: 'view_id', code: 'not_found' },
  { test: /^Use either filters or board_filters/, field: 'filters', code: 'invalid_value' },
  { test: /^Use either label_names\/assignee_ids\/match or board_filters/, field: 'label_names', code: 'invalid_value' },
  { test: /^subtask_setting must be/, field: 'subtask_setting', code: 'invalid_value' },
  { test: /^board_empty_sections must be/, field: 'board_empty_sections', code: 'invalid_value', allowed_values: ['Show', 'Hidden'] },
  { test: /^match must be 'ALL' or 'ANY'$/, field: 'match', code: 'invalid_value', allowed_values: ['ALL', 'ANY'] },
  { test: /^project_id and title are required$/, field: 'project_id', code: 'missing_field' },
  { test: /^title cannot be empty$/, field: 'title', code: 'invalid_value' },
  { test: /^set_as_default must be a boolean$/, field: 'set_as_default', code: 'invalid_type' },
]

export function viewMutationRefusal(error: unknown) {
  if (error instanceof ValidationError) {
    const details = error.details
    if (details && typeof details.field === 'string') {
      return viewInputRefusal(
        error.message,
        details.field,
        typeof details.code === 'string' ? details.code : 'invalid_value',
        Array.isArray(details.allowed_values) ? details.allowed_values.map(String) : undefined,
      )
    }
  }
  const message = error instanceof Error ? error.message : 'Internal server error'
  const mapped = MESSAGE_REFUSALS.find(({ test }) => test.test(message))
  if (mapped) {
    return viewInputRefusal(message, mapped.field, mapped.code, mapped.allowed_values)
  }
  return NextResponse.json({ success: false, error: message }, { status: 400 })
}
