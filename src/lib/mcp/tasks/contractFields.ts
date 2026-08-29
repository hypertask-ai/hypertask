export const riskLevels = ['Low', 'Medium', 'High'] as const

export type RiskLevelValue = (typeof riskLevels)[number]

const LOWERCASE_TO_ENUM: Record<string, RiskLevelValue> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

export function normalizeRiskLevel(
  value?: unknown
): RiskLevelValue | null {
  if (value === undefined) return null
  if (typeof value !== 'string') return null
  const exact = riskLevels.find((riskLevel) => riskLevel === value)
  if (exact) return exact
  return LOWERCASE_TO_ENUM[value.trim().toLowerCase()] ?? null
}

const MAX_ACCEPTANCE_CRITERIA = 5000
const MAX_VERIFY_COMMAND = 2000

export type ContractFieldUpdates = {
  riskLevel?: RiskLevelValue | null
  acceptanceCriteria?: string | null
  verifyCommand?: string | null
}

export type ContractFieldsParseResult =
  | { ok: true; value: ContractFieldUpdates }
  | { ok: false; field: string; error: string }

export function parseContractFieldsInput(body: {
  risk_level?: unknown
  acceptance_criteria?: unknown
  verify_command?: unknown
}): ContractFieldsParseResult {
  const value: ContractFieldUpdates = {}

  if (body.risk_level !== undefined) {
    const riskLevel = normalizeRiskLevel(body.risk_level)
    if (riskLevel === null) {
      return {
        ok: false,
        field: 'risk_level',
        error: 'risk_level must be one of low, medium, high',
      }
    }
    value.riskLevel = riskLevel
  }

  if (body.acceptance_criteria !== undefined) {
    if (typeof body.acceptance_criteria !== 'string') {
      return {
        ok: false,
        field: 'acceptance_criteria',
        error: 'acceptance_criteria must be a string',
      }
    }
    const acceptanceCriteria = body.acceptance_criteria.trim()
    if (acceptanceCriteria.length > MAX_ACCEPTANCE_CRITERIA) {
      return {
        ok: false,
        field: 'acceptance_criteria',
        error: `acceptance_criteria may be at most ${MAX_ACCEPTANCE_CRITERIA} characters`,
      }
    }
    value.acceptanceCriteria =
      acceptanceCriteria === '' ? null : acceptanceCriteria
  }

  if (body.verify_command !== undefined) {
    if (typeof body.verify_command !== 'string') {
      return {
        ok: false,
        field: 'verify_command',
        error: 'verify_command must be a string',
      }
    }
    const verifyCommand = body.verify_command.trim()
    if (verifyCommand.length > MAX_VERIFY_COMMAND) {
      return {
        ok: false,
        field: 'verify_command',
        error: `verify_command may be at most ${MAX_VERIFY_COMMAND} characters`,
      }
    }
    value.verifyCommand = verifyCommand === '' ? null : verifyCommand
  }

  return { ok: true, value }
}
