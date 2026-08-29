import {
  FULL_MANAGEMENT_KEY_PERMISSIONS,
  hasLegacyFullPermissionShape,
  isKnownManagementPermissionResource,
  isPermissionSubset,
} from '@/lib/mcp/managementPermissions'

export type ManagementKeyPermissionMap = Record<string, string[]>

export const managementKeyScopeLabel = (
  permissions: ManagementKeyPermissionMap,
) => {
  const resourceNames = Object.keys(permissions)
  const hasKnownResources = resourceNames.every(isKnownManagementPermissionResource)
  const hasFullDataAccess =
    hasKnownResources &&
    (hasLegacyFullPermissionShape(permissions) ||
      isPermissionSubset(FULL_MANAGEMENT_KEY_PERMISSIONS, permissions))

  if (hasFullDataAccess) {
    return "Full account access"
  }

  if (
    resourceNames.length === 1 &&
    Array.isArray(permissions.usage) &&
    permissions.usage.length === 1 &&
    permissions.usage[0] === "read"
  ) {
    return "Usage only"
  }

  if (
    resourceNames.length === 1 &&
    Array.isArray(permissions.management) &&
    permissions.management.length > 0 &&
    permissions.management.every((action) => action === "read" || action === "write")
  ) {
    return "Management only"
  }
  return "Unknown"
}
