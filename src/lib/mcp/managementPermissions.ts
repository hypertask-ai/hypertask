export type ManagementPermissions = Record<string, string[]>

export const MANAGEMENT_KEY_PERMISSIONS: ManagementPermissions = {
  management: ['read', 'write'],
}

export const FULL_MANAGEMENT_KEY_PERMISSIONS: ManagementPermissions = {
  management: ['read', 'write'],
  data: ['read', 'write'],
  usage: ['read'],
}

export const USAGE_READ_KEY_PERMISSIONS: ManagementPermissions = {
  usage: ['read'],
}

const MANAGEMENT_PERMISSION_RESOURCES = ['management', 'data', 'usage'] as const

const FULL_DATA_KEY_PERMISSIONS: ManagementPermissions = {
  management: ['read', 'write'],
  data: ['read', 'write'],
}

const MANAGEMENT_READ_PERMISSION: ManagementPermissions = {
  management: ['read'],
}

const MANAGEMENT_WRITE_PERMISSION: ManagementPermissions = {
  management: ['write'],
}

const USAGE_READ_PERMISSION: ManagementPermissions = {
  usage: ['read'],
}

const hasUsagePermissionEntry = (permissions: ManagementPermissions) =>
  Object.prototype.hasOwnProperty.call(permissions, 'usage')

export function isKnownManagementPermissionResource(resource: string): boolean {
  return (MANAGEMENT_PERMISSION_RESOURCES as readonly string[]).includes(resource)
}

export function isPermissionSubset(
  requested: ManagementPermissions,
  granted: ManagementPermissions
): boolean {
  return Object.entries(requested).every(([resource, actions]) => {
    const grantedActions = granted[resource] ?? []
    return actions.every((action) => grantedActions.includes(action))
  })
}

export function hasManagementPermission(
  permissions: ManagementPermissions
): boolean {
  return isPermissionSubset(MANAGEMENT_KEY_PERMISSIONS, permissions)
}

export function hasManagementReadPermission(
  permissions: ManagementPermissions
): boolean {
  return isPermissionSubset(MANAGEMENT_READ_PERMISSION, permissions)
}

export function hasManagementWritePermission(
  permissions: ManagementPermissions
): boolean {
  return isPermissionSubset(MANAGEMENT_WRITE_PERMISSION, permissions)
}

export function hasAnyManagementPermission(
  permissions: ManagementPermissions
): boolean {
  return hasManagementReadPermission(permissions) ||
    hasManagementWritePermission(permissions)
}

export function hasDataPermission(
  permissions: ManagementPermissions
): boolean {
  return isPermissionSubset(FULL_DATA_KEY_PERMISSIONS, permissions)
}

/** Existing full keys predate the usage scope and therefore have no usage entry. */
export function hasLegacyFullPermissionShape(
  permissions: ManagementPermissions
): boolean {
  return (
    !hasUsagePermissionEntry(permissions) &&
    isPermissionSubset(FULL_DATA_KEY_PERMISSIONS, permissions)
  )
}

/**
 * A full key without a usage entry uses the pre-scope permission shape, so it
 * retains access to this narrower read-only surface for compatibility. An
 * explicit usage entry controls the new scope.
 */
export function hasUsageReadPermission(
  permissions: ManagementPermissions
): boolean {
  return isPermissionSubset(USAGE_READ_PERMISSION, permissions) ||
    hasLegacyFullPermissionShape(permissions)
}

export function parseManagementPermissions(
  value: unknown
): ManagementPermissions {
  let parsed = value

  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      return {}
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {}
  }

  const permissions: ManagementPermissions = {}
  for (const [resource, actions] of Object.entries(parsed)) {
    if (
      Array.isArray(actions) &&
      actions.every((action): action is string => typeof action === 'string')
    ) {
      permissions[resource] = actions
    }
  }

  return permissions
}
