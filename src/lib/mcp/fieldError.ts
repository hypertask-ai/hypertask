export type McpFieldErrorCode =
  | 'invalid_field'
  | 'missing_field'
  | 'not_found'
  | 'forbidden'

export type McpAllowedValue = string | number | boolean | null

export function buildFieldError(
  code: McpFieldErrorCode,
  field: string,
  message: string,
  allowedValues?: readonly McpAllowedValue[]
) {
  return {
    success: false as const,
    error: message,
    code,
    field,
    ...(allowedValues !== undefined
      ? { allowed_values: [...allowedValues] }
      : {}),
  }
}
