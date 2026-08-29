import { randomBytes } from 'crypto';

/**
 * Generates a unique correlation ID for request tracing
 * Format: timestamp-randomhex (e.g., "1704067200000-a3f2b1c4")
 */
export function generateCorrelationId(): string {
  const timestamp = Date.now();
  const random = randomBytes(4).toString('hex');
  return `${timestamp}-${random}`;
}
