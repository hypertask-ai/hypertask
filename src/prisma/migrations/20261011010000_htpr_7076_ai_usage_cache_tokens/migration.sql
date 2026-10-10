-- HTPR-7076: record how many prompt tokens came from or went into the provider cache.
ALTER TABLE "AiUsage"
  ADD COLUMN "cachedInputTokens" INTEGER,
  ADD COLUMN "cacheWriteInputTokens" INTEGER;
