/**
 * Field blacklisting/serialization utility for MCP responses
 * Removes sensitive internal database fields before sending to clients
 */

/**
 * Fields that should be blacklisted (removed) from MCP responses
 * These are sensitive/internal fields that MCP clients don't need
 * 
 * Note: Operational IDs (sectionId, projectId, etc.) are kept because
 * MCP clients need them to perform updates and operations.
 */
const BLACKLISTED_FIELDS = new Set([
  // Sensitive user/auth fields
  'userId',
  'creatorId',
  'ownerId',
  
  // Internal database references (not needed by MCP clients)
  'commentId', // Use comment.id instead
  'taskId',    // Use task.id instead
  
  // Creator/Updater references (internal)
  'createdBy',
  'updatedBy',
  
  // Duplicate/internal representation fields
  // NOTE: Do NOT blacklist 'commentText' - backend may return commentText instead of text (HTPR-3032).
  // Clients use: c.text ?? c.commentText
  
  // Internal system flags (if not needed)
  // 'deleted',
  // 'visibility',
  
  // Note: Keeping these for MCP client operations:
  // - id, projectId, sectionId, boardId (needed for updates/operations)
  // - priority_index, estimate_index (needed for normalization)
  // - uniqueIndex (needed for efficient lookups)
]);

/**
 * Recursively removes blacklisted fields from an object or array
 * 
 * @param obj - The object or array to sanitize
 * @returns A new object/array with blacklisted fields removed
 */
export function sanitizeResponse<T>(obj: T): T {
  // Handle null/undefined
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeResponse(item)) as T;
  }

  // Handle primitives (string, number, boolean, etc.)
  if (typeof obj !== 'object') {
    return obj;
  }

  // Handle Date objects
  if (obj instanceof Date) {
    return obj;
  }

  // Handle plain objects - use Object.keys to ensure we iterate over own properties
  const sanitized: Record<string, unknown> = {};
  const sourceObj = obj as Record<string, unknown>;
  
  for (const key of Object.keys(sourceObj)) {
    // Skip blacklisted fields
    if (BLACKLISTED_FIELDS.has(key)) {
      continue;
    }

    const value = sourceObj[key];
    
    // Recursively sanitize nested objects/arrays
    sanitized[key] = sanitizeResponse(value);
  }

  return sanitized as T;
}
