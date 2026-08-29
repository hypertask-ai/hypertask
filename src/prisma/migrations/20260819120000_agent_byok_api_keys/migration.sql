-- Per-agent provider keys (HTPR-5389): an agent can run on its own provider
-- account instead of the shared team key.
CREATE TABLE "AgentByokApiKey" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "ciphertext" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentByokApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentByokApiKey_agentId_provider_key" ON "AgentByokApiKey"("agentId", "provider");

CREATE INDEX "AgentByokApiKey_agentId_idx" ON "AgentByokApiKey"("agentId");

ALTER TABLE "AgentByokApiKey" ADD CONSTRAINT "AgentByokApiKey_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
