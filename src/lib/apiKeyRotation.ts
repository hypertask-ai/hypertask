/**
 * The rotation write, isolated from the HTTP route so the concurrency rule can
 * be driven directly by tests.
 *
 * Rotation must be one-for-one: exactly one replacement per revoked key. Two
 * requests can read the same active key before either writes, so the revoke is
 * conditional on the key still being active and the replacement is created only
 * by the request whose revoke actually claimed it. The loser gets null.
 */
// Method shorthand (not arrow properties) so a real Prisma transaction client,
// whose argument types are far more specific, still satisfies this shape.
export type RotationTransactionClient = {
  apiKey: {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    updateMany(args: any): Promise<{ count: number }>
    create(args: any): Promise<any>
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }
}

export async function rotateApiKeyInTransaction<T>(
  tx: RotationTransactionClient,
  input: {
    id: string
    userId: number
    name: string
    keyHash: string
    keyPrefix: string
    expiresAt: Date | null
    now: Date
    select: unknown
  }
): Promise<T | null> {
  const claimed = await tx.apiKey.updateMany({
    where: { id: input.id, revokedAt: null },
    data: { revokedAt: input.now },
  })

  if (claimed.count === 0) return null

  return (await tx.apiKey.create({
    data: {
      userId: input.userId,
      name: input.name,
      keyHash: input.keyHash,
      keyPrefix: input.keyPrefix,
      expiresAt: input.expiresAt,
    },
    select: input.select,
  })) as T
}
