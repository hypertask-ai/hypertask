-- Filing an agent away without switching it off or deleting it.
ALTER TABLE "Agent" ADD COLUMN "archivedAt" TIMESTAMP(3);
