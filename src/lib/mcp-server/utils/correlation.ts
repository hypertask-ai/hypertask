import { randomBytes } from 'crypto';

export function generateCorrelationId(): string {
  const timestamp = Date.now();
  const random = randomBytes(4).toString('hex');
  return `${timestamp}-${random}`;
}
