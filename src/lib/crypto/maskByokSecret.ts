export function maskByokSecret(secret: string): string {
  return `••••••••${secret.slice(-4)}`;
}
