import { z } from 'zod'
import { createTaskIdentificationBaseSchema } from './common/task-identification'

const MAX_QUESTION_LENGTH = 2000
const MIN_OPTIONS = 2
const MAX_OPTIONS = 10
const MAX_OPTION_LENGTH = 200

export function getDecisionRequestCrudBaseSchema() {
  return createTaskIdentificationBaseSchema()
    .extend({
      action: z
        .enum(['create', 'list', 'get', 'answer', 'cancel'])
        .default('create')
        .describe(
          "Operation: 'create' and 'list' require a task identifier; 'get', 'answer', and 'cancel' require decision_request_id"
        ),
      decision_request_id: z.coerce
        .number()
        .int()
        .positive('decision_request_id must be a positive integer')
        .optional()
        .describe('Decision request ID. Required for get, answer, and cancel.'),
      question: z
        .string()
        .max(
          MAX_QUESTION_LENGTH,
          `question cannot exceed ${MAX_QUESTION_LENGTH} characters`
        )
        .optional()
        .describe('Question for the human. Required for create.'),
      options: z
        .array(
          z
            .string()
            .max(MAX_OPTION_LENGTH, `each option cannot exceed ${MAX_OPTION_LENGTH} characters`)
        )
        .min(MIN_OPTIONS, `options must contain at least ${MIN_OPTIONS} items`)
        .max(MAX_OPTIONS, `options cannot contain more than ${MAX_OPTIONS} items`)
        .optional()
        .describe('Distinct choices for the human. Required for create.'),
      status: z
        .enum(['pending', 'answered', 'cancelled'])
        .optional()
        .describe('Optional status filter for list.'),
      selected_option: z
        .string()
        .max(MAX_OPTION_LENGTH, `selected_option cannot exceed ${MAX_OPTION_LENGTH} characters`)
        .optional()
        .describe('Exact option to select. Required for answer.'),
      note: z.string().optional().describe('Optional human note supplied with an answer.'),
    })
    .strict()
}

export function getDecisionRequestCrudInputSchema() {
  return getDecisionRequestCrudBaseSchema().superRefine((data, ctx) => {
    const {
      action,
      task_id,
      ticket_number,
      project_id,
      unique_index,
      decision_request_id,
      question,
      options,
      selected_option,
    } = data

    if (action === 'create' || action === 'list') {
      const hasTaskId = task_id !== undefined
      const hasTicketNumber = ticket_number !== undefined
      const hasUniqueIndex = unique_index !== undefined
      const methodCount = [hasTaskId, hasTicketNumber, hasUniqueIndex].filter(Boolean).length

      if (methodCount === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `For action ${action}: provide task_id, ticket_number, or (project_id + unique_index)`,
          path: ['task_id'],
        })
      }
      if (methodCount > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `For action ${action}: use only one task identification method`,
          path: ['task_id'],
        })
      }
      if (hasUniqueIndex && project_id === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'project_id is required when using unique_index',
          path: ['project_id'],
        })
      }
    }

    if (action === 'create') {
      if (!question || question.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'For action create: question is required',
          path: ['question'],
        })
      }

      if (!options) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'For action create: options are required',
          path: ['options'],
        })
      } else {
        const trimmedOptions = options.map((option) => option.trim())
        if (trimmedOptions.some((option) => option === '')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Each option must be non-empty after trimming',
            path: ['options'],
          })
        }
        if (new Set(trimmedOptions).size !== trimmedOptions.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Options must not contain duplicates',
            path: ['options'],
          })
        }
      }
    }

    if (action === 'get' || action === 'answer' || action === 'cancel') {
      if (decision_request_id === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `For action ${action}: decision_request_id is required`,
          path: ['decision_request_id'],
        })
      }
    }

    if (action === 'answer' && (!selected_option || selected_option.trim() === '')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'For action answer: selected_option is required',
        path: ['selected_option'],
      })
    }
  })
}

export const DecisionRequestCrudInputSchema = getDecisionRequestCrudInputSchema()
export type DecisionRequestCrudInput = z.infer<typeof DecisionRequestCrudInputSchema>

export function validateAndSanitizeDecisionRequestCrudInput(
  input: unknown
): DecisionRequestCrudInput {
  const validated = DecisionRequestCrudInputSchema.parse(input)
  return {
    ...validated,
    ...(validated.question !== undefined ? { question: validated.question.trim() } : {}),
    ...(validated.options !== undefined
      ? { options: validated.options.map((option) => option.trim()) }
      : {}),
    ...(validated.selected_option !== undefined
      ? { selected_option: validated.selected_option.trim() }
      : {}),
    ...(validated.note !== undefined ? { note: validated.note.trim() } : {}),
  }
}
