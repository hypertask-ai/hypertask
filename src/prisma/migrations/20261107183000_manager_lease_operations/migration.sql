CREATE TABLE "ManagerLeaseOperation" (
    "id" SERIAL NOT NULL,
    "agentId" TEXT NOT NULL,
    "operationId" VARCHAR(64) NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "grantHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagerLeaseOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManagerLeaseOperation_agentId_operationId_key" ON "ManagerLeaseOperation"("agentId", "operationId");
