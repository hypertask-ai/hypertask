
const BLACKLISTED_FIELDS = new Set([
  'userId',
  'creatorId',
  'ownerId',
  
  'commentId',
  'taskId',
  
  'createdBy',
  'updatedBy',

]);

export function sanitizeResponse<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeResponse(item)) as T;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  if (obj instanceof Date) {
    return obj;
  }

  const sanitized: Record<string, unknown> = {};
  const sourceObj = obj as Record<string, unknown>;
  
  for (const key of Object.keys(sourceObj)) {
    if (BLACKLISTED_FIELDS.has(key)) {
      continue;
    }

    const value = sourceObj[key];
    
    sanitized[key] = sanitizeResponse(value);
  }

  return sanitized as T;
}
