export type RotationTransactionClient = {
  apiKey: {

    updateMany(args: any): Promise<{ count: number }>
    create(args: any): Promise<any>

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
